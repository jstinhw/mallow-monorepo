import { describe, it, expect } from 'vitest';
import { mainnet, base, arbitrum, optimism } from 'viem/chains';
import {
  supportedChainIds,
  chainConfigs,
  isChainSupported,
  getChainInfo,
  getChain,
  getRpcUrl,
  getBundlerRpcUrl,
  getCCTPDomain,
  getCCTPUrl,
} from './chains.js';

describe('chains constants', () => {
  describe('supportedChainIds', () => {
    it('includes all four supported chains', () => {
      expect(supportedChainIds).toContain(1);
      expect(supportedChainIds).toContain(10);
      expect(supportedChainIds).toContain(42161);
      expect(supportedChainIds).toContain(8453);
      expect(supportedChainIds).toHaveLength(4);
    });
  });

  describe('chainConfigs', () => {
    it('has config for each supported chain', () => {
      for (const chainId of supportedChainIds) {
        expect(chainConfigs[chainId]).toBeDefined();
      }
    });

    it('mainnet config has correct wrapped native token', () => {
      expect(chainConfigs[1].wrappedNative).toBe(
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
      );
    });

    it('each config has ETH, USDC, and USDT tokens', () => {
      for (const chainId of supportedChainIds) {
        const config = chainConfigs[chainId];
        expect(config.tokens.ETH).toBeDefined();
        expect(config.tokens.USDC).toBeDefined();
        expect(config.tokens.USDT).toBeDefined();
      }
    });

    it('all configs are marked as mainnet', () => {
      for (const chainId of supportedChainIds) {
        expect(chainConfigs[chainId].isMainnet).toBe(true);
      }
    });
  });

  describe('isChainSupported', () => {
    it('returns true for supported chain IDs', () => {
      expect(isChainSupported(1)).toBe(true);
      expect(isChainSupported(10)).toBe(true);
      expect(isChainSupported(42161)).toBe(true);
      expect(isChainSupported(8453)).toBe(true);
    });

    it('returns false for unsupported chain IDs', () => {
      expect(isChainSupported(56)).toBe(false);
      expect(isChainSupported(137)).toBe(false);
      expect(isChainSupported(0)).toBe(false);
      expect(isChainSupported(999999)).toBe(false);
    });

    it('handles bigint input', () => {
      expect(isChainSupported(1n)).toBe(true);
      expect(isChainSupported(42161n)).toBe(true);
      expect(isChainSupported(56n)).toBe(false);
    });
  });

  describe('getChainInfo', () => {
    it('returns chain info for valid chain IDs', () => {
      const ethInfo = getChainInfo(1);
      expect(ethInfo.chain).toBe(mainnet);
      expect(ethInfo.isMainnet).toBe(true);

      const arbInfo = getChainInfo(42161);
      expect(arbInfo.chain).toBe(arbitrum);
    });

    it('handles bigint chain IDs', () => {
      const info = getChainInfo(8453n);
      expect(info.chain).toBe(base);
    });

    it('throws for unsupported chain IDs', () => {
      expect(() => getChainInfo(56)).toThrow('Unsupported chain ID: 56');
      expect(() => getChainInfo(0)).toThrow('Unsupported chain ID: 0');
    });
  });

  describe('getChain', () => {
    it('returns the viem Chain object for each supported chain', () => {
      expect(getChain(1)).toBe(mainnet);
      expect(getChain(10)).toBe(optimism);
      expect(getChain(42161)).toBe(arbitrum);
      expect(getChain(8453)).toBe(base);
    });

    it('throws for unsupported chain', () => {
      expect(() => getChain(56)).toThrow('Unsupported chain ID: 56');
    });
  });

  describe('getRpcUrl', () => {
    it('returns an Alchemy RPC URL for supported chains', () => {
      const url = getRpcUrl(1);
      expect(url).toContain('alchemy.com');
      expect(url).toContain('eth-mainnet');
    });

    it('returns different URLs for different chains', () => {
      const ethUrl = getRpcUrl(1);
      const arbUrl = getRpcUrl(42161);
      expect(ethUrl).not.toBe(arbUrl);
      expect(arbUrl).toContain('arb-mainnet');
    });

    it('throws for unsupported chain', () => {
      expect(() => getRpcUrl(56)).toThrow('Unsupported chain ID: 56');
    });
  });

  describe('getBundlerRpcUrl', () => {
    it('returns a ZeroDev bundler URL for supported chains', () => {
      const url = getBundlerRpcUrl(1);
      expect(url).toContain('zerodev.app');
      expect(url).toContain('/chain/1');
    });

    it('includes chain ID in the URL', () => {
      expect(getBundlerRpcUrl(42161)).toContain('/chain/42161');
      expect(getBundlerRpcUrl(8453)).toContain('/chain/8453');
    });

    it('throws for unsupported chain', () => {
      expect(() => getBundlerRpcUrl(56)).toThrow('Unsupported chain ID: 56');
    });
  });

  describe('getCCTPDomain', () => {
    it('returns correct CCTP domain for each chain', () => {
      expect(getCCTPDomain(1)).toBe(0);
      expect(getCCTPDomain(10)).toBe(2);
      expect(getCCTPDomain(42161)).toBe(3);
      expect(getCCTPDomain(8453)).toBe(6);
    });

    it('throws for unsupported chain', () => {
      expect(() => getCCTPDomain(56)).toThrow('Unsupported chain ID: 56');
    });
  });

  describe('getCCTPUrl', () => {
    it('returns the Circle CCTP API URL for mainnet chains', () => {
      const url = getCCTPUrl(1);
      expect(url).toBe('https://iris-api.circle.com/v2');
    });

    it('returns a URL for all supported chains', () => {
      for (const chainId of supportedChainIds) {
        const url = getCCTPUrl(chainId);
        expect(url).toContain('iris-api.circle.com');
      }
    });

    it('throws for unsupported chain', () => {
      expect(() => getCCTPUrl(56)).toThrow('Unsupported chain ID: 56');
    });
  });
});
