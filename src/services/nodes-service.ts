import { Inject, Service } from 'typedi';
import { Response } from 'express';
import { NodeRepository } from '../repositories/node-repository';
import { Node, NodeInfo } from '../database/models/node';
import {
  CreateNodeType,
  NodeFilterQueryParams,
} from '../validators/node-validators';
import WireguardService, {
  WGConfigObject,
} from './wireguard/wireguard-service';
import { HttpServicesService } from './http-services-service';
import { TcpServicesService } from './tcp-services-service';
import { PatService } from './pat-service';
import { NotFoundError } from 'routing-controllers';
import { NodeQueryFilter } from '../repositories/filters/node-query-filter';
import Net from '../utils/net';
import { PagedData } from '../repositories/filters/repository-query-filter';

@Service()
export class NodesService {
  constructor(
    @Inject() private readonly nodeRepository: NodeRepository,
    @Inject() private readonly nodeFilter: NodeQueryFilter,
    @Inject() private readonly wireguardService: WireguardService,
    @Inject() private readonly httpServicesService: HttpServicesService,
    @Inject() private readonly tcpServicesService: TcpServicesService,
    @Inject() private readonly patService: PatService,
  ) {}

  public async initialize(): Promise<void> {
    const gateways = await this.nodeRepository.find({
      where: { isGateway: true },
    });

    for (const gw of gateways) {
      if (gw.enabled) {
        this.configureGateway(gw);
      }
    }
  }

  public async getAll(): Promise<Node[]> {
    return this.nodeRepository.find();
  }

  public async getNodes(
    filters: NodeFilterQueryParams,
  ): Promise<Node | Node[] | PagedData<Node>> {
    return this.nodeFilter.apply(filters);
  }

  public async getNodesRuntime(nodes?: Node[]): Promise<NodeInfo[]> {
    if (!nodes) {
      nodes = await this.getAll();
    }

    return this.wireguardService.getRuntimeInfo(nodes);
  }

  public async createNode(params: CreateNodeType): Promise<Node> {
    const client = await this.wireguardService.getClientParams(params);
    const node = await this.nodeRepository.save(client);

    await this.wireguardService.loadConfig();

    await this.configureGateway(node);

    return node;
  }

  public async createNodeWithPAT(params: CreateNodeType): Promise<Node> {
    const node = await this.createNode(params);

    const pat = await this.patService.createNodePAT(+node.id, {
      name: 'default',
    });

    console.log(pat);

    return {
      ...node,
      personalAccessTokens: [pat],
    };
  }

  public async getNode(id: number): Promise<Node> {
    const node = await this.nodeRepository.findOne({ where: { id } });

    if (!node) {
      throw new NotFoundError('Node not found!');
    }

    return node;
  }

  public async getNodeInfo(id: number): Promise<NodeInfo> {
    const node = await this.getNode(id);

    return this.wireguardService.getNodeRuntimeInfo(node);
  }

  public async getNodeRuntime(node: Node): Promise<NodeInfo> {
    return this.wireguardService.getNodeRuntimeInfo(node);
  }

  public async getNodeConfig(id: number): Promise<string> {
    const node = await this.getNode(id);

    return this.wireguardService.getClientConfig(node);
  }

  public async getNodeWGConfig(id: number): Promise<WGConfigObject> {
    const node = await this.getNode(id);

    const wgConfig = await this.wireguardService.getClientWGConfig(node);

    return wgConfig;
  }

  public async downloadNodeConfig(
    id: number,
    res: Response,
  ): Promise<Response> {
    const node = await this.getNode(id);
    const config = await this.wireguardService.getClientConfig(node);

    res.set(
      'Content-Disposition',
      `attachment; filename="wiredoor-${node.name}-config.conf"`,
    );
    res.write(config);

    return res.send();
  }

  public async updateNode(
    id: number,
    params: Partial<CreateNodeType>,
  ): Promise<Node> {
    const old = await this.getNode(id);

    if (old.isGateway) {
      await this.disableGateway(old);
    }

    await this.nodeRepository.save({
      id,
      ...params,
    });

    const updatedNode = await this.getNode(id);

    if (updatedNode.isGateway) {
      await this.configureGateway(updatedNode);
    }

    await this.wireguardService.loadConfig();

    return updatedNode;
  }

  public async enableNode(id: number): Promise<Node> {
    return this.updateNode(id, { enabled: true });
  }

  public async disableNode(id: number): Promise<Node> {
    return this.updateNode(id, { enabled: false });
  }

  public async deleteNode(id: number): Promise<string> {
    const old = await this.getNode(id);

    if (old.isGateway) {
      await this.disableGateway(old);
    }

    await this.nodeRepository.delete(id);

    await this.wireguardService.loadConfig();

    await this.httpServicesService.initialize();
    await this.tcpServicesService.initialize();

    return 'Instance deleted';
  }

  private async disableGateway(node: Node): Promise<void> {
    if (node.isGateway) {
      await Net.delRoute(node.gatewayNetwork, node.address);
    }
  }

  private async configureGateway(node: Node): Promise<void> {
    if (node.isGateway) {
      await Net.addRoute(node.gatewayNetwork, node.address);
    }
  }
}
