# BonkFun Bundler

[![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-Web3.js-purple.svg)](https://www.npmjs.com/package/@solana/web3.js)

A TypeScript CLI for automated token bundling on [letsbonk.fun](https://letsbonk.fun/). Supports multi-wallet coordination, Jito bundle execution, and configurable launch and exit strategies.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Launch Strategies](#launch-strategies)
- [Exit Strategies](#exit-strategies)
- [API Reference](#api-reference)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

BonkFun Bundler automates token creation, distribution, and trading on letsbonk.fun. It coordinates operations across multiple wallets and uses Jito bundles to reduce MEV exposure during launches and sells.

**Capabilities**

| Area | Description |
|------|-------------|
| Token launch | Vanity addresses, metadata upload, Jito and delayed bundle modes |
| Wallet management | Generate up to 20 wallets, distribute SOL, import/export keypairs |
| Trading | Coordinated multi-wallet buys and sells with slippage controls |
| Exit strategies | Sell-all, dev dump, delayed sell, and SOL recovery |

## Features

### Token Creation and Launch

- **Vanity address generation** — Custom mint suffixes via `solana-keygen grind` (multi-threaded)
- **Metadata management** — Automated creation and IPFS upload (name, symbol, description, social links, image)
- **Jito bundler mode** — Atomic bundles with up to 5 transactions per bundle
- **Delayed bundle mode** — Sequential execution with configurable random delays
- **Snipe mode** — Coordinated buys on existing tokens

### Wallet Management

- Bulk wallet generation (up to 20)
- Equal, custom, or percentage-based SOL distribution
- Batch operations, balance consolidation, and transaction history

### Trading

- Configurable buy amounts per wallet
- Slippage protection (default 50%)
- Priority fee optimization and confirmation monitoring

## Installation

### Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- Solana CLI (required for vanity address generation)
- Solana RPC endpoint

### Setup

```bash
git clone https://github.com/cicere/bonkfun-bundler.git
cd bonkfun-bundler
npm install
```

Install Solana CLI (for vanity addresses):

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

Configure environment:

```bash
cp .env.example .env
```

Edit `.env`:

```env
RPC=https://your-rpc-endpoint.com
SECRET_KEY=your-main-wallet-private-key
API_KEY=your-license-key
DEBUG=false
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `RPC` | Solana RPC endpoint URL | Yes | — |
| `SECRET_KEY` | Main wallet private key | Yes | — |
| `API_KEY` | License key for activation | Yes | — |
| `DEBUG` | Enable debug logging | No | `false` |

### Token Metadata

Create `tokenMetadata.json`:

```json
{
  "tokenName": "Your Token Name",
  "tokenSymbol": "SYMBOL",
  "description": "Token description",
  "tokenShowName": "Display Name",
  "twitter": "https://x.com/yourhandle",
  "telegram": "https://t.me/yourgroup",
  "website": "https://yourwebsite.com",
  "file": "token-image.jpg",
  "jitoTipAmtInput": "0.01"
}
```

### Wallet Limits

| Setting | Value |
|---------|-------|
| Maximum wallets | 20 |
| Minimum SOL per wallet | 0.01 SOL |
| Distribution methods | Equal, custom, percentage-based |

## Usage

Start the application:

```bash
npm start
# or
yarn start
# or
npx ts-node main.ts
```

The CLI presents three main sections:

1. **Wallet Management** — Generate wallets and distribute SOL
2. **Launch UI** — Create and launch tokens
3. **Sell UI** — Exit positions and recover funds

## Launch Strategies

### Jito Bundler Launch

Recommended for MEV-protected launches. Process flow:

1. Vanity address generation (optional)
2. Token metadata creation
3. Token creation transaction
4. Multi-wallet buy transactions
5. All operations submitted as a single Jito bundle

| Option | Range |
|--------|-------|
| Buy amount per wallet | 0.01 – 10 SOL |
| Jito tip | 0.0001 – 0.1 SOL |

### Delayed Bundle Launch

Sequential execution with random delays (5–30 seconds) between wallet buys. Useful when a staggered entry pattern is preferred.

### Snipe Existing Token

1. Enter target token address
2. Configure buy amounts per wallet
3. Execute coordinated buys
4. Monitor confirmation status

### Wallet Operations

| Action | Steps |
|--------|-------|
| Create wallets | Wallet Management → Generate Wallets → enter count (1–20) |
| Distribute SOL | Wallet Management → Distribute SOL → choose method → confirm |

## Exit Strategies

### Sell All

Coordinated sells across all wallets, bundled via Jito for efficiency.

### Dev Dump

Transfers tokens from all wallets to the main wallet, then executes a single sell transaction.

### Delayed Sell

Individual wallet sells with configurable delays between transactions.

### SOL Recovery

Closes token accounts and recovers rent-exempt SOL balances.

### Buy Configuration Example

```json
{
  "buyAmount": 0.1,
  "slippage": 50,
  "priorityFee": 0.0001,
  "confirmations": "confirmed"
}
```

## API Reference

### BonkfunSDK

```typescript
interface BonkfunSDK {
  createToken(metadata: TokenMetadata): Promise<Transaction>;
  buyToken(mint: PublicKey, amount: number): Promise<Transaction>;
  sellToken(mint: PublicKey, amount: number): Promise<Transaction>;
  getTokenInfo(mint: PublicKey): Promise<TokenInfo>;
}
```

### WalletManager

```typescript
class WalletManager {
  generateWallets(count: number): Keypair[];
  distributeSOL(amount: number, method: DistributionMethod): Promise<void>;
  getBalances(): Promise<WalletBalance[]>;
  exportWallets(): WalletExport;
  importWallets(data: WalletExport): void;
}
```

### LaunchManager

```typescript
class LaunchManager {
  launchWithJito(config: LaunchConfig): Promise<LaunchResult>;
  launchWithDelay(config: LaunchConfig): Promise<LaunchResult>;
  snipeToken(mint: PublicKey, config: SnipeConfig): Promise<SnipeResult>;
}
```

### Types

```typescript
interface TokenMetadata {
  tokenName: string;
  tokenSymbol: string;
  description: string;
  tokenShowName: string;
  twitter: string;
  telegram: string;
  website: string;
  file: string;
}

interface LaunchConfig {
  metadata: TokenMetadata;
  buyAmounts: number[];
  jitoTip: number;
  useVanity: boolean;
}
```

## Security

### Private Key Management

- Never commit or share private keys
- Store keys in environment variables only
- Use a dedicated wallet for bundler operations
- Keep minimal SOL in operational wallets

### Transaction Safety

- Sensitive operations use Jito bundles
- Slippage protection on all trades
- Address validation before execution

### Recommended Practices

1. Back up wallet configurations regularly
2. Monitor transactions for unexpected behavior
3. Use premium RPC endpoints for production workloads
4. Keep dependencies up to date

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| Vanity address timeout | Increase timeout; verify Solana CLI installation and CPU availability |
| Transaction failed | Check RPC status, wallet balances, slippage, and priority fees |
| Bundle submission error | Verify Jito endpoint availability, tip amount, and bundle size limits |

Enable debug logging:

```env
DEBUG=true
```

Debug output includes transaction construction, RPC logs, bundle composition, and timing metrics.

### Vanity Address Performance

| Suffix length | Estimated time |
|---------------|----------------|
| 2 characters | 5–30 seconds |
| 3 characters | 30 seconds – 2 minutes |
| 4 characters | 1–10 minutes |

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | Multi-core | Multi-core (for vanity generation) |
| RAM | 4 GB | 8 GB |
| Storage | 500 MB | 500 MB |
| Network | Stable, low-latency connection | Premium RPC recommended |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Install dependencies and run tests: `npm test`
4. Submit a pull request

Code style: TypeScript strict mode, ESLint, Prettier.

## License

This software is provided for legitimate token operations on [letsbonk.fun](https://letsbonk.fun/). Users are responsible for compliance with applicable laws and platform terms of service. The developers assume no liability for misuse.
