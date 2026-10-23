import { Test, TestingModule } from '@nestjs/testing';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('HealthService（F15 健康检查与诊断）', () => {
  let service: HealthService;
  let mockDataSource: Partial<DataSource>;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockDataSource = { query: jest.fn() };
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService, { provide: DataSource, useValue: mockDataSource }],
    }).compile();
    service = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    loggerWarnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('存活探针不检查依赖，恒返回 ok', () => {
    expect(service.live()).toEqual({ status: 'ok' });
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('就绪探针在数据库可达时返回 ready', async () => {
    (mockDataSource.query as jest.Mock).mockResolvedValue([{ 1: 1 }]);
    await expect(service.ready()).resolves.toEqual({ status: 'ready', database: 'connected' });
  });

  it('就绪探针在数据库不可达时抛 503，不让编排器继续引流', async () => {
    (mockDataSource.query as jest.Mock).mockRejectedValue(new Error('Connection refused'));
    await expect(service.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('就绪探针在数据库挂起时按超时判定为 503，不无限等待', async () => {
    jest.useFakeTimers();
    (mockDataSource.query as jest.Mock).mockReturnValue(new Promise(() => {}));
    const pending = service.ready();
    const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it('聚合状态视图在数据库失败时标记 degraded 且仍含时间与运行时长', async () => {
    (mockDataSource.query as jest.Mock).mockRejectedValue(new Error('down'));
    const result = await service.aggregate();
    expect(result.status).toBe('degraded');
    expect(result.database).toBe('disconnected');
    expect(typeof result.uptime).toBe('number');
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('诊断输出运行状态与数据库延迟，但不泄露任何密钥与凭据值', async () => {
    process.env.JWT_SECRET = 'diagnostic-secret-value';
    process.env.DB_PASSWORD = 'diagnostic-password-value';
    process.env.ADMIN_DEFAULT_PASSWORD = 'diagnostic-admin-pass';
    (mockDataSource.query as jest.Mock).mockResolvedValue([{ 1: 1 }]);
    try {
      const result = await service.diagnostics();
      expect(result.status).toBe('running');
      expect(result.database.connected).toBe(true);
      expect(typeof result.database.pingMs).toBe('number');
      expect(result.attachments.privateDirWritable).toBe(true);
      expect(result.memory.rssBytes).toBeGreaterThan(0);
      expect(result.appVersion).not.toBe('unknown');
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('diagnostic-secret-value');
      expect(serialized).not.toContain('diagnostic-password-value');
      expect(serialized).not.toContain('diagnostic-admin-pass');
    } finally {
      delete process.env.JWT_SECRET;
      delete process.env.DB_PASSWORD;
      delete process.env.ADMIN_DEFAULT_PASSWORD;
    }
  });

  it('附件私有目录不可写时诊断明确报告 false 而不是静默通过', async () => {
    process.env.ATTACHMENT_PRIVATE_DIR = 'package.json';
    (mockDataSource.query as jest.Mock).mockRejectedValue(new Error('down'));
    try {
      const result = await service.diagnostics();
      expect(result.attachments.privateDirWritable).toBe(false);
      expect(result.database.connected).toBe(false);
      expect(result.database.pingMs).toBeNull();
    } finally {
      delete process.env.ATTACHMENT_PRIVATE_DIR;
    }
  });
});
