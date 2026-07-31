import { CHAINLINK_AGGREGATOR_V3_ABI } from '../../abis/chainlink-aggregator-v3.abi.js';
import type {
  OracleProvider,
  OracleFeedConfig,
  PriceData,
} from '../../types/oracle.js';
import { OracleType } from '../../types/oracle.js';
import { getPublicClient } from '../../utils/client.js';

/**
 * Chainlink oracle provider
 * Fetches price data from Chainlink AggregatorV3 price feeds
 */
export class ChainlinkOracle implements OracleProvider {
  readonly type = OracleType.CHAINLINK;

  async fetchPrice(feedConfig: OracleFeedConfig): Promise<PriceData> {
    const client = getPublicClient(feedConfig.chainId);
    const [, answer, , updatedAt] = await client.readContract({
      address: feedConfig.address,
      abi: CHAINLINK_AGGREGATOR_V3_ABI,
      functionName: 'latestRoundData',
    });

    if (answer <= 0n) {
      throw new Error(
        `Chainlink returned invalid price for feed ${feedConfig.address}`
      );
    }

    return {
      price: answer,
      priceDecimals: feedConfig.decimals,
      updatedAt,
      source: this.type,
    };
  }
}

export const chainlinkOracle = new ChainlinkOracle();
