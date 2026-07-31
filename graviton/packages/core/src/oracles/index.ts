import type { Address } from 'viem';
import { getTokenName, ORACLES_REGISTRY } from '../constants/index.js';
import {
  type OracleProvider,
  type OracleFeedConfig,
  type PriceData,
  OracleType,
} from '../types/index.js';
import { chainlinkOracle } from './providers/chainlink.js';

/**
 * Oracle registry - manages all available oracle providers
 */
class OracleRegistry {
  private providers = new Map<OracleType, OracleProvider>();

  constructor() {
    // Register default providers
    this.register(chainlinkOracle);
  }

  register(provider: OracleProvider): void {
    this.providers.set(provider.type, provider);
  }

  get(type: OracleType): OracleProvider | undefined {
    return this.providers.get(type);
  }

  has(type: OracleType): boolean {
    return this.providers.has(type);
  }

  /**
   * Fetch price from a single oracle
   */
  async fetchFromOracle(feedConfig: OracleFeedConfig): Promise<PriceData> {
    const provider = this.providers.get(feedConfig.type);
    if (!provider) {
      throw new Error(`Unknown oracle type: ${feedConfig.type}`);
    }
    return provider.fetchPrice(feedConfig);
  }

  /**
   * Fetch price from multiple oracles in parallel, return first valid result
   * Uses Promise.any to get the first successful response
   */
  async fetchPriceFromOracles(oracles: OracleFeedConfig[]): Promise<PriceData> {
    if (oracles.length === 0) {
      throw new Error('No oracle feeds configured');
    }

    if (oracles.length === 1) {
      return this.fetchFromOracle(oracles[0]!);
    }

    // Fetch from all oracles in parallel, return first valid result
    try {
      return await Promise.any(
        oracles.map((oracle) => this.fetchFromOracle(oracle))
      );
    } catch (error) {
      if (error instanceof AggregateError) {
        throw new Error(
          `All oracles failed: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  }

  /**
   * Fetch price from configured oracles
   * Fetches from all configured oracles in parallel and returns the first valid result
   * @param chainId - The chain ID
   * @param tokenAddress - The token address
   * @returns Price data including the price, decimals, last update time, and source
   */
  async fetchPrice(chainId: number, tokenAddress: Address): Promise<PriceData> {
    const tokenName = getTokenName(chainId, tokenAddress);
    const oracles = ORACLES_REGISTRY[tokenName];

    if (oracles.length === 0) {
      throw new Error(
        `Token ${tokenAddress} has no oracle feeds configured on chain ${chainId}.`
      );
    }

    return this.fetchPriceFromOracles(oracles);
  }
}

export const oracleRegistry = new OracleRegistry();
