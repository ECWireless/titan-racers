import { verifyMessage } from "viem";

// Every sign-in message names Base so a wallet is one login method whatever
// network it is on. EOA signatures do not depend on the chain.
export const SIWE_CHAIN_ID = 8453;

// Wallet-first racers get a placeholder email at this domain, never shown.
export const WALLET_EMAIL_DOMAIN = "wallet.invalid";

const walletAddressPattern = /^0x[0-9a-fA-F]{40}$/;

export function isWalletAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && walletAddressPattern.test(value);
}

// Offline check only: viem recovers the signer of an EIP-191 signature, so
// smart-contract wallets never verify.
export async function verifyWalletSignature({
  address,
  chainId,
  message,
  signature,
}: {
  address: string;
  chainId: number;
  message: string;
  signature: string;
}) {
  if (chainId !== SIWE_CHAIN_ID || !isWalletAddress(address)) return false;
  try {
    return await verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
