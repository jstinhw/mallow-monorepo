import { describe, it, expect } from 'vitest';
import { type Address, zeroAddress } from 'viem';
import {
  tokenConfigs,
  getTokenInfo,
  getTokenBalanceSlot,
  getTokenName,
  getTokenDecimals,
  isNativeToken,
  getUSDCAddress,
  isUSDC,
} from './tokens.js';

const MAINNET_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address;
const ARB_USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address;
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const RANDOM_ADDR = '0x1234567890abcdef1234567890abcdef12345678' as Address;

describe('tokens constants', () => {
  describe('tokenConfigs', () => {
    it('has config for ETH, USDC, and USDT', () => {
      expect(tokenConfigs.ETH).toBeDefined();
      expect(tokenConfigs.USDC).toBeDefined();
      expect(tokenConfigs.USDT).toBeDefined();
    });

    it('each config has oracles and stubAmount', () => {
      for (const [, config] of Object.entries(tokenConfigs)) {
        expect(config.oracles).toBeDefined();
        expect(Array.isArray(config.oracles)).toBe(true);
        expect(typeof config.stubAmount).toBe('number');
      }
    });

    it('ETH has a smaller stub amount than stablecoins', () => {
      expect(tokenConfigs.ETH.stubAmount).toBeLessThan(
        tokenConfigs.USDC.stubAmount
      );
    });
  });

  describe('getTokenInfo', () => {
    it('returns token info for known tokens on mainnet', () => {
      const usdc = getTokenInfo(1, MAINNET_USDC);
      expect(usdc).toBeDefined();
      expect(usdc!.symbol).toBe('USDC');
      expect(usdc!.decimals).toBe(6);
    });

    it('returns token info for native token', () => {
      const eth = getTokenInfo(1, zeroAddress);
      expect(eth).toBeDefined();
      expect(eth!.symbol).toBe('ETH');
      expect(eth!.decimals).toBe(18);
    });

    it('returns token info for tokens on Arbitrum', () => {
      const usdc = getTokenInfo(42161, ARB_USDC);
      expect(usdc).toBeDefined();
      expect(usdc!.symbol).toBe('USDC');
    });

    it('returns undefined for unknown token address', () => {
      const result = getTokenInfo(1, RANDOM_ADDR);
      expect(result).toBeUndefined();
    });

    it('is case-insensitive for address comparison', () => {
      const lower = MAINNET_USDC.toLowerCase() as Address;
      const result = getTokenInfo(1, lower);
      expect(result).toBeDefined();
      expect(result!.symbol).toBe('USDC');
    });
  });

  describe('getTokenBalanceSlot', () => {
    it('returns a hex string for valid token/chain', () => {
      const sender = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address;
      const slot = getTokenBalanceSlot(1, MAINNET_USDC, sender);
      expect(slot).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('returns different slots for different senders', () => {
      const sender1 = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address;
      const sender2 = '0x1234567890abcdef1234567890abcdef12345678' as Address;
      const slot1 = getTokenBalanceSlot(1, MAINNET_USDC, sender1);
      const slot2 = getTokenBalanceSlot(1, MAINNET_USDC, sender2);
      expect(slot1).not.toBe(slot2);
    });

    it('throws for token without balanceOffset (native token)', () => {
      const sender = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address;
      expect(() => getTokenBalanceSlot(1, zeroAddress, sender)).toThrow(
        'not found on chain'
      );
    });

    it('throws for unknown token', () => {
      const sender = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Address;
      expect(() => getTokenBalanceSlot(1, RANDOM_ADDR, sender)).toThrow(
        'not found on chain'
      );
    });
  });

  describe('getTokenName', () => {
    it('returns correct name for USDC on mainnet', () => {
      expect(getTokenName(1, MAINNET_USDC)).toBe('USDC');
    });

    it('returns correct name for USDT on Arbitrum', () => {
      expect(getTokenName(42161, ARB_USDT)).toBe('USDT');
    });

    it('returns ETH for native token', () => {
      expect(getTokenName(1, zeroAddress)).toBe('ETH');
    });

    it('throws for unknown token', () => {
      expect(() => getTokenName(1, RANDOM_ADDR)).toThrow('not found on chain');
    });
  });

  describe('getTokenDecimals', () => {
    it('returns 6 for USDC', () => {
      expect(getTokenDecimals(1, MAINNET_USDC)).toBe(6);
    });

    it('returns 18 for native ETH', () => {
      expect(getTokenDecimals(1, zeroAddress)).toBe(18);
    });

    it('returns 6 for USDT on Arbitrum', () => {
      expect(getTokenDecimals(42161, ARB_USDT)).toBe(6);
    });

    it('throws for unknown token', () => {
      expect(() => getTokenDecimals(1, RANDOM_ADDR)).toThrow(
        'not found on chain'
      );
    });
  });

  describe('isNativeToken', () => {
    it('returns true for zero address', () => {
      expect(isNativeToken(zeroAddress)).toBe(true);
    });

    it('returns true for zero address in different case', () => {
      expect(
        isNativeToken('0x0000000000000000000000000000000000000000' as Address)
      ).toBe(true);
    });

    it('returns false for non-zero address', () => {
      expect(isNativeToken(MAINNET_USDC)).toBe(false);
    });

    it('returns false for random address', () => {
      expect(isNativeToken(RANDOM_ADDR)).toBe(false);
    });
  });

  describe('getUSDCAddress', () => {
    it('returns correct USDC address for mainnet', () => {
      expect(getUSDCAddress(1)).toBe(MAINNET_USDC);
    });

    it('returns correct USDC address for Arbitrum', () => {
      expect(getUSDCAddress(42161)).toBe(ARB_USDC);
    });

    it('returns correct USDC address for Base', () => {
      expect(getUSDCAddress(8453)).toBe(BASE_USDC);
    });

    it('throws for unsupported chain', () => {
      expect(() => getUSDCAddress(56)).toThrow('Unsupported chain ID');
    });
  });

  describe('isUSDC', () => {
    it('returns true for USDC address on correct chain', () => {
      expect(isUSDC(1, MAINNET_USDC)).toBe(true);
      expect(isUSDC(42161, ARB_USDC)).toBe(true);
    });

    it('returns false for non-USDC address', () => {
      expect(isUSDC(1, zeroAddress)).toBe(false);
      expect(isUSDC(1, RANDOM_ADDR)).toBe(false);
    });

    it('returns false for USDC address on wrong chain', () => {
      expect(isUSDC(42161, MAINNET_USDC)).toBe(false);
    });

    it('is case-insensitive', () => {
      const lower = MAINNET_USDC.toLowerCase() as Address;
      expect(isUSDC(1, lower)).toBe(true);
    });
  });
});
