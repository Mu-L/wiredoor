import { Inject, Service } from 'typedi';
import { DomainRepository } from '../repositories/domain-repository';
import {
  Domain,
  Oauth2ProxyConfig,
  SSLTermination,
} from '../database/models/domain';
import { NginxManager } from './proxy-server/nginx-manager';
import { DomainQueryFilter } from '../repositories/filters/domain-query-filter';
import {
  DomainFilterQueryParams,
  DomainType,
} from '../validators/domain-validator';
import { SSLManager } from './proxy-server/ssl-manager';
import { NotFoundError } from 'routing-controllers';
import Net from '../utils/net';
import { PagedData } from '../repositories/filters/repository-query-filter';
import { ValidationError } from '../utils/errors/validation-error';
import { ProcessManager } from './oauth2-proxy/process-manager';

@Service()
export class DomainsService {
  constructor(
    @Inject() private readonly domainRepository: DomainRepository,
    @Inject() private readonly domainFilter: DomainQueryFilter,
  ) {}

  public async initialize(): Promise<void> {
    const domains = await this.domainRepository.find();

    for (const domain of domains) {
      await this.buildServerConfig(domain, false);
    }
  }

  public async getAll(): Promise<Domain[]> {
    return this.domainRepository.find();
  }

  public async getDomains(
    filters: DomainFilterQueryParams,
  ): Promise<Domain | Domain[] | PagedData<Domain>> {
    return this.domainFilter.apply(filters);
  }

  public async createDomain(
    params: DomainType,
    restart = true,
  ): Promise<Domain> {
    let oauth2ServicePort = null;
    let oauth2Config: Oauth2ProxyConfig = null;

    if (params.authentication) {
      oauth2ServicePort = await this.domainRepository.getAvailablePort();
      oauth2Config = {
        allowedEmails: params.allowedEmails,
      };
    }

    const sslCerts = await SSLManager.getSSLCertificates(
      params.domain,
      params.ssl as SSLTermination,
    );

    const domain = await this.domainRepository.save({
      ...params,
      sslPair: sslCerts,
      oauth2ServicePort,
      oauth2Config,
    });

    await this.buildServerConfig(domain, restart);

    return domain;
  }

  public async createDomainIfNotExists(domain: string): Promise<Domain> {
    const instance = await this.domainRepository.getDomainByName(domain);

    if (instance) {
      return instance;
    }

    const pointTothisServer = await Net.lookupIncludesThisServer(domain);

    return this.createDomain(
      {
        domain,
        ssl: pointTothisServer
          ? SSLTermination.Certbot
          : SSLTermination.SelfSigned,
      },
      false,
    );
  }

  public async getDomain(id: number): Promise<Domain> {
    const domain = await this.domainRepository.findOne({ where: { id } });

    if (!domain) {
      throw new NotFoundError('Domain not found!');
    }

    return domain;
  }

  public async updateDomain(
    id: number,
    params: Partial<DomainType>,
  ): Promise<Domain> {
    const old = await this.getDomain(id);

    if (params.domain && params.domain !== old.domain) {
      throw new ValidationError({
        body: [
          {
            field: 'domain',
            message:
              "Domain names can't be changed. Add a new one and delete this one instead.",
          },
        ],
      });
    }

    let sslPair = old.sslPair;

    if (old.ssl !== params.ssl || old.domain !== params.domain) {
      sslPair = await SSLManager.getSSLCertificates(
        params.domain,
        params.ssl as SSLTermination,
      );
    }

    await this.domainRepository.save({
      id,
      ...params,
      sslPair,
    });

    const domain = await this.getDomain(id);

    await this.buildServerConfig(domain);

    return domain;
  }

  public async deleteDomain(id: number): Promise<string> {
    const domain = await this.getDomain(id);

    if (domain.oauth2ServicePort) {
      await ProcessManager.removeOauthProcess(domain);
    }

    await NginxManager.removeDomainServerConfig(domain);

    await this.domainRepository.delete(id);

    return 'Deleted!';
  }

  public async buildServerConfig(
    domain: Domain,
    restart = true,
  ): Promise<void> {
    if (!domain.sslPair && domain.ssl) {
      domain.sslPair = await SSLManager.getSSLCertificates(
        domain.domain,
        domain.ssl as SSLTermination,
      );

      await this.domainRepository.save(domain);
    }

    if (domain.oauth2ServicePort) {
      await ProcessManager.addOauthProcess(domain, restart);
    }

    await NginxManager.addDomainServer(domain, restart);
  }
}
