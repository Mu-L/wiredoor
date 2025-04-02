const jwt = require('jsonwebtoken')
const { default: config } = require('src/config');

const mockLookup = jest.fn((c) => {
  return Promise.resolve(c);
});

const mockAxiosGet = jest.fn(() => {
  return Promise.resolve({
    status: 200,
    data: ''
  });
});
const mockAxiosPost = jest.fn(() => {
  return Promise.resolve({
    status: 200,
    data: ''
  });
});

const mockCLIExec = jest.fn((c) => {
  return Promise.resolve({
    stdout: `${c} stdout`,
    stderr: ``,
  })
});

const mockSaveToFile = jest.fn();

const mockGenPrivateKey = jest.fn(async () => {
  return Promise.resolve('private_key');
});

const mockGenPublicKey = jest.fn(async (privateKey) => {
  return Promise.resolve('public_key');
});

const mockGenPreSharedKey = jest.fn(async () => {
  return Promise.resolve('shared_key');
});

jest.mock('dns', () => {
  return {
    resolve: mockLookup,
  }
});

jest.mock('axios', () => {
  return {
    get: mockAxiosGet,
    post: mockAxiosPost,
  }
});

const mockSyncConf = jest.fn();
const mockQuickUp = jest.fn();
const mockQuickDown = jest.fn();
const mockDumpRuntimeInfo = jest.fn();
const mockPeerRuntimeInfo = jest.fn();

const mockRemoveDir = jest.fn();
const mockRemoveFile = jest.fn();
const mockIsPath = jest.fn(() => { return false });

const mockNslookup = jest.fn(() => { return true });
const mockCheckPort = jest.fn(() => { return true });

jest.mock('../../utils/cli.ts', () => {
  return {
    exec: mockCLIExec,
  };
});

jest.mock('../../utils/net.ts', () => {
  return {
    addRoute: jest.fn(),
    delRoute: jest.fn(),
    isReachable: jest.fn(),
    nslookup: mockNslookup,
    lookupIncludesThisServer: mockNslookup,
    isIPForwardEnabled: jest.fn(),
    checkPort: mockCheckPort,
  };
});

jest.mock('../../utils/iptables.ts', () => {
  return {
    ruleExists: jest.fn(),
    showRules: jest.fn(),
    addRules: jest.fn(),
    addRule: jest.fn(),
    deleteRules: jest.fn(),
    deleteRule: jest.fn(),
  };
});

jest.mock('../../utils/file-manager.ts', () => {
  return {
    isFile: jest.fn(() => { return false }),
    isPath: mockIsPath,
    isDirectory: jest.fn(),
    mkdirSync: jest.fn(() => { return true; }),
    listDirectories: jest.fn(),
    readDirectory: jest.fn(),
    readFile: jest.fn(),
    readFileInDir: jest.fn(),
    saveToFile: mockSaveToFile,
    appendToFile: jest.fn(),
    rename: jest.fn(),
    removeDir: mockRemoveDir,
    removeFile: mockRemoveFile,
  }
})

jest.mock('../../utils/wg-cli.ts', () => {
  return {
    genPrivateKey: mockGenPrivateKey,
    genPublicKey: mockGenPublicKey,
    genPreSharedKey: mockGenPreSharedKey,
    syncConf: mockSyncConf,
    quickUp: mockQuickUp,
    quickDown: mockQuickDown,
    dumpPeerRuntimeInfo: mockPeerRuntimeInfo,
    dumpRunTimeInfo: mockDumpRuntimeInfo,
  };
});

function mockAuthenticatedToken(c) {
  const claims = { id: c?.id || 0, node: c?.name || 'admin', address: c?.address, type: c?.type || 'admin' }
  return jwt.sign(claims, config.jwt.secret);
}

module.exports = {
  mockLookup,
  mockAxiosGet,
  mockAxiosPost,
  mockCLIExec,
  mockSaveToFile,
  mockGenPrivateKey,
  mockGenPublicKey,
  mockGenPreSharedKey,
  mockSyncConf,
  mockQuickUp,
  mockQuickDown,
  mockIsPath,
  mockRemoveDir,
  mockRemoveFile,
  mockNslookup,
  mockCheckPort,
  mockAuthenticatedToken
};
