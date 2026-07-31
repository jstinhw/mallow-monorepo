import type { KernelSmartAccountImplementation } from '@zerodev/sdk';
import { eip712WrapHash } from '@zerodev/sdk';
import { MAGIC_VALUE_SIG_REPLAYABLE, VALIDATOR_TYPE } from '@zerodev/sdk/constants';
import { MerkleTree } from 'merkletreejs';
import {
  concatHex,
  encodeAbiParameters,
  type Hex,
  hashMessage,
  keccak256,
  parseErc6492Signature,
} from 'viem';
import type { SmartAccount } from 'viem/account-abstraction';
import type { Order } from '../types/order.js';
import { getOrderHash } from './getOrderHash.js';

type SignOrdersParams = {
  kernelAccount: SmartAccount<KernelSmartAccountImplementation>;
  orders: Order[];
};

/**
 * Signs multiple orders using Merkle tree batching for efficiency.
 *
 * This function:
 * 1. Hashes each order
 * 2. Wraps hashes in EIP-712 format with kernel account metadata
 * 3. Builds a Merkle tree from the wrapped hashes
 * 4. Signs the Merkle root with the kernel account
 * 5. Generates individual signatures for each order with their Merkle proofs
 *
 * The Merkle tree approach allows batching: one signature covers multiple orders,
 * with each order including a proof that verifies it's part of the signed batch.
 *
 * @param params - Parameters including kernel account and orders to sign
 * @returns Array of orders with populated signatures
 */
export async function signOrders(params: SignOrdersParams): Promise<Order[]> {
  const { kernelAccount, orders } = params;

  // Step 1: Hash and wrap each order in EIP-712 format
  const orderHashes = await Promise.all(
    orders.map(async (order) => {
      const orderHash = hashMessage({ raw: getOrderHash(order) });

      const wrappedMessageHash = await eip712WrapHash(
        orderHash,
        {
          name: 'Kernel',
          chainId: BigInt(order.srcIntent.chainId),
          version: kernelAccount.kernelVersion,
          verifyingContract: kernelAccount.address,
        },
        true, // replayable
      );
      return wrappedMessageHash;
    }),
  );

  // Step 2: Build Merkle tree from wrapped hashes
  const merkleTree = new MerkleTree(orderHashes, keccak256, {
    sortPairs: true,
  });

  // Step 3: Sign the Merkle root
  const merkleRoot = merkleTree.getHexRoot() as Hex;
  const ecdsaSig = await kernelAccount.kernelPluginManager.signMessage({
    message: {
      raw: merkleRoot,
    },
  });

  // Step 4: Generate signature for each order with its Merkle proof
  const encodeMerkleDataWithSig = (orderHash: Hex) => {
    const merkleProof = merkleTree.getHexProof(orderHash) as Hex[];
    const encodedMerkleProof = encodeAbiParameters(
      [{ name: 'proof', type: 'bytes32[]' }],
      [merkleProof],
    );
    return concatHex([ecdsaSig, merkleRoot, encodedMerkleProof]);
  };

  // Step 5: Attach signatures to orders
  const signatures = orderHashes.map((orderHash) => {
    const signature = concatHex([
      VALIDATOR_TYPE.SUDO,
      MAGIC_VALUE_SIG_REPLAYABLE,
      encodeMerkleDataWithSig(orderHash),
    ]);
    const { signature: signature_ } = parseErc6492Signature(signature);
    return signature_;
  });

  return orders.map((order, index) => {
    order.signature = signatures[index] as Hex;
    return order;
  });
}
