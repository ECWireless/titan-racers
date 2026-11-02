"use client";

import { useEffect, useState } from "react";
import { getAddress, stringToHex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { z } from "zod";

import { SIWE_CHAIN_ID } from "@/lib/siwe";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type BrowserWallet = { id: string; name: string; provider: Eip1193Provider };

export type SignedWalletMessage = {
  address: `0x${string}`;
  message: string;
  signature: string;
};

export class WalletRequestCancelledError extends Error {}

const announcementSchema = z.object({
  info: z.object({ name: z.string().min(1), uuid: z.string().min(1) }),
  provider: z.custom<Eip1193Provider>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as Eip1193Provider).request === "function",
  ),
});

// EIP-6963: injected wallets announce themselves when asked.
export function useBrowserWallets() {
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);

  useEffect(() => {
    function onAnnounce(event: Event) {
      const parsed = announcementSchema.safeParse(
        (event as CustomEvent<unknown>).detail,
      );
      if (!parsed.success) return;
      const { info, provider } = parsed.data;
      setWallets((current) =>
        current.some((wallet) => wallet.id === info.uuid)
          ? current
          : [...current, { id: info.uuid, name: info.name.slice(0, 40), provider }],
      );
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () =>
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  return wallets;
}

async function walletRequest(
  wallet: BrowserWallet,
  method: string,
  params?: unknown[],
) {
  try {
    return await wallet.provider.request({ method, params });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === 4001
    ) {
      throw new WalletRequestCancelledError();
    }
    throw error;
  }
}

// Asks the wallet for its account and a signed Sign-In with Ethereum message
// bound to this site and a fresh server nonce. Linking signs the same kind of message.
export async function signWalletMessage(
  wallet: BrowserWallet,
  statement: string,
): Promise<SignedWalletMessage> {
  const accounts = z
    .array(z.string())
    .min(1)
    .parse(await walletRequest(wallet, "eth_requestAccounts"));
  const address = getAddress(accounts[0]);

  const nonceResponse = await fetch("/api/auth/siwe/nonce", {
    body: JSON.stringify({ chainId: SIWE_CHAIN_ID, walletAddress: address }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!nonceResponse.ok) throw new Error("A sign-in nonce was unavailable.");
  const { nonce } = z
    .object({ nonce: z.string() })
    .parse(await nonceResponse.json());

  const issuedAt = new Date();
  const message = createSiweMessage({
    address,
    chainId: SIWE_CHAIN_ID,
    domain: window.location.host,
    expirationTime: new Date(issuedAt.getTime() + 10 * 60_000),
    issuedAt,
    nonce,
    statement,
    uri: window.location.origin,
    version: "1",
  });
  const signature = z
    .string()
    .parse(
      await walletRequest(wallet, "personal_sign", [
        stringToHex(message),
        address,
      ]),
    );
  return { address, message, signature };
}
