import { Inject, Service } from 'typedi';
import { TcpServiceRepository } from '../repositories/tcp-service-repository';
import { TcpService } from '../database/models/tcp-service';
import {
  TcpServiceFilterQueryParams,
  TcpServiceType,
} from '../validators/tcp-service-validator';
import { TcpServiceQueryFilter } from '../repositories/filters/tcp-service-query-filter';
import Net from '../utils/net';
import { BadRequestError, NotFoundError } from 'routing-controllers';
import { NodeRepository } from '../repositories/node-repository';
import IP_CIDR from '../utils/ip-cidr';
import { DomainsService } from './domains-service';
import { NginxManager } from './proxy-server/nginx-manager';
import { ValidationError } from '../utils/errors/validation-error';
import { PagedData } from '../repositories/filters/repository-query-filter';

@Service()
export class TcpServicesService {
  constructor(
    @Inject() private readonly tcpServiceRepository: TcpServiceRepository,
    @Inject() private readonly tcpServiceFilter: TcpServiceQueryFilter,
    @Inject() private readonly nodeRepository: NodeRepository,
    @Inject() private readonly domainsService: DomainsService,
  ) {}

  public async initialize(): Promise<void> {
    const services = await this.tcpServiceRepository.find({
      relations: ['node'],
    });

    for (const service of services) {
      if (service.enabled) {
        await this.buildServerConfig(service);
      }
    }
  }

  public async getTcpServices(
    params: TcpServiceFilterQueryParams,
  ): Promise<TcpService | TcpService[] | PagedData<TcpService>> {
    return this.tcpServiceFilter.apply(params);
  }

  public async getNodeTcpServices(
    nodeId: number,
    params: TcpServiceFilterQueryParams,
  ): Promise<TcpService | TcpService[] | PagedData<TcpService>> {
    return this.tcpServiceFilter.apply({ ...params, nodeId });
  }

  public async getTcpService(
    id: number,
    relations: string[] = [],
  ): Promise<TcpService> {
    return this.tcpServiceRepository.findOne({
      where: { id },
      relations,
    });
  }

  public async getNodeTcpService(
    id: number,
    nodeId: number,
    relations: string[] = [],
  ): Promise<TcpService> {
    const service = await this.tcpServiceRepository.findOne({
      where: { id, nodeId },
      relations,
    });

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    return service;
  }

  public async createTcpService(
    nodeId: number,
    params: TcpServiceType,
  ): Promise<TcpService> {
    if (!params.port) {
      const port = await this.tcpServiceRepository.getAvailablePort();

      params.port = port;
    }

    await this.checkNodePort(nodeId, params.backendPort, params.backendHost);

    const { id } = await this.tcpServiceRepository.save({ ...params, nodeId });

    const service = await this.getTcpService(id, ['node']);

    await this.buildServerConfig(service);

    return service;
  }

  public async updateTcpService(
    id: number,
    params: Partial<TcpServiceType>,
  ): Promise<TcpService> {
    const old = await this.getTcpService(id, ['node']);

    const portAvailable = await Net.checkPort(
      old.node.address,
      params.backendPort,
    );

    if (!portAvailable) {
      throw new BadRequestError(
        `Unable to reach out port ${params.backendPort} in node ${old.node.name}`,
      );
    }

    await NginxManager.removeTcpService(old, false);

    await this.tcpServiceRepository.save({
      id,
      ...params,
    });

    const service = await this.getTcpService(id, ['node']);

    await this.buildServerConfig(service);

    return service;
  }

  public async updateNodeTcpService(
    id: number,
    nodeId: number,
    params: Partial<TcpServiceType>,
  ): Promise<TcpService> {
    await this.getNodeTcpService(id, nodeId);

    return this.updateTcpService(id, params);
  }

  enableService(id: number): Promise<TcpService> {
    return this.updateTcpService(id, { enabled: true });
  }

  enableNodeService(id: number, nodeId: number): Promise<TcpService> {
    return this.updateNodeTcpService(id, nodeId, { enabled: true });
  }

  disableService(id: number): Promise<TcpService> {
    return this.updateTcpService(id, { enabled: false });
  }

  disableNodeService(id: number, nodeId: number): Promise<TcpService> {
    return this.updateNodeTcpService(id, nodeId, { enabled: false });
  }

  public async deleteTcpService(id: number): Promise<string> {
    const service = await this.getTcpService(id, ['node']);

    await NginxManager.removeTcpService(service);

    await this.tcpServiceRepository.delete(id);

    return 'Deleted!';
  }

  private async checkNodePort(
    nodeId: number,
    port: number,
    host?: string,
  ): Promise<void> {
    const node = await this.nodeRepository.findOne({
      where: { id: nodeId },
    });

    if (!node) {
      throw new NotFoundError('Node not found!');
    }

    const server = node.isGateway && host ? host : node.address;
    const resolver =
      node.isGateway && host && !IP_CIDR.isValidIP(host) ? node.address : null;

    const portAvailable = await Net.checkPort(server, port, resolver);

    if (!portAvailable) {
      throw new ValidationError({
        body: [
          {
            field: 'backendPort',
            message: `Unable to reach out port ${port} in node ${node.name}`,
          },
        ],
      });
    }
  }

  async buildServerConfig(
    tcpService: TcpService,
    restart = true,
  ): Promise<void> {
    if (tcpService.domain) {
      await this.domainsService.createDomainIfNotExists(tcpService.domain);
    }

    await NginxManager.handleTcpService(tcpService, restart);
  }
}
