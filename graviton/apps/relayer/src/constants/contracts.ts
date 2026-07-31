import { type Address, isAddressEqual } from 'viem';

/**
 * Mapping of InteropExecutor addresses to their corresponding Simulator addresses
 * Used for gas estimation with state simulation
 */
export const EXECUTOR_TO_SIMULATOR: Record<Address, Address> = {
  // Add additional mappings as needed for different deployments
  '0xDb8Ac16d1B3A0acF6FF48a9420dc81DfD1195670':
    '0x7D336990d7B0C44c980C8cfF6edA416753De113F',
  // '0x...': '0x...',

  '0x5e0de196118baA88b06101bABff8784fb85403f3':
    '0x6A2B39e60bd45717E89bDCFc0B59652C6e579BB7',

  '0xa380ad1Ac9B842aF0C45ee1798F797a651f17d72':
    '0xA4B0F881eDC267bFc19049C388BA075c22664Ca2',

  '0x9df84e4086a5CDe2639AB1D6673EC899D95f9cAE':
    '0xd4f9bBf0500454780e1Ffc64C6Ffd4AC50B7f73e',
};

export const INTEROP_EXECUTOR = '0x9df84e4086a5CDe2639AB1D6673EC899D95f9cAE';

/**
 * Bridge adapter addresses
 */
export const CCTP_ADAPTER: Address =
  '0x6726934014A521F60acA9280137bfb3A86B25b0e';
export const CCTP_ADAPTER_SIMULATOR: Address =
  '0x62F84C0CF791fBa0219c92F33a315554E9199314';
export const ACROSS_ADAPTER: Address =
  '0xD1581d09649e0AE7674218A4BCBB5B76B67CA314';
export const LAYERZERO_ADAPTER: Address =
  '0x9DB22E287f842EA2732bFB21d055E6ceF6fB530f';

/**
 * Default native ETH fee for LayerZero messaging (adapter refunds unused)
 */
export const LZ_DEFAULT_NATIVE_FEE: bigint = 150_000_000_000_000n;

export const MAX_ATTESTATION_RETRIES = 100;

/**
 * Get the simulator address for a given InteropExecutor address
 * Performs case-insensitive lookup to handle different address formats
 * @param executorAddress - The InteropExecutor contract address (any case)
 * @returns The corresponding simulator contract address
 * @throws Error if no simulator mapping exists for the executor
 */
export function getSimulatorAddress(executorAddress: Address): Address {
  // Find the simulator address with case-insensitive lookup
  const simulatorAddress = Object.entries(EXECUTOR_TO_SIMULATOR).find(
    ([executor]) => isAddressEqual(executor as Address, executorAddress)
  )?.[1];

  if (!simulatorAddress) {
    throw new Error(
      `No simulator address found for InteropExecutor: ${executorAddress}. ` +
        `Please add the mapping in EXECUTOR_TO_SIMULATOR.`
    );
  }

  return simulatorAddress;
}
