# Bonkfun Bundler - Advanced Token Bundler for letsbonk.fun

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-Web3.js-purple.svg)](https://solana-labs.github.io/solana-web3.js/)

The **Bonkfun Bundler** is a professional, automated token bundling solution specifically designed for [letsbonk.fun](https://letsbonk.fun/) - the new hype of Solana. This comprehensive tool allows you to deploy a token on bonk in 3 different modes, and sell with up to 6 modes.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage Guide](#usage-guide)
  - [Token Launch Strategies](#token-launch-strategies)
  - [Wallet Management](#wallet-management)
  - [Trading Operations](#trading-operations)
  - [Exit Strategies](#exit-strategies)
- [Advanced Features](#advanced-features)
- [API Reference](#api-reference)
- [Security Considerations](#security-considerations)
- [Performance Optimization](#performance-optimization)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Overview

The **letsbonk bundler** revolutionizes token operations on bonk.fun by providing a unified, automated solution for token creators. Unlike manual processes that are time-consuming and error-prone, this bonk bundler automates every aspect of token management while maintaining security and efficiency.

### Why Choose Bonkfun Bundler?

- **Automation**: Complete automation of token creation, distribution, and management
- **MEV Protection**: All operations utilize Jito bundles for maximum extractable value protection
- **Multi-Wallet Coordination**: Seamlessly manage operations across multiple wallets
- **Professional Features**: Enterprise-grade features for serious token operations
- **Solana Optimized**: Built specifically for Solana's architecture and bonk.fun's requirements

## Key Features

### 🚀 Token Creation & Launch

The bonkfun bundler provides sophisticated token creation capabilities:

#### Vanity Address Generation
- Generate token addresses ending with custom suffixes (e.g., "bonk")
- Utilizes native `solana-keygen grind` for maximum performance
- Multi-threaded operation using all available CPU cores
- Configurable timeouts and retry mechanisms
- Probability-based time estimates for user expectations

#### Metadata Management
- Automated metadata creation and upload
- Support for all bonk.fun required fields:
  - Token name and symbol
  - Description and display name
  - Social links (Twitter, Telegram, Website)
  - Token image upload and processing
- IPFS integration for decentralized storage

#### Launch Modes

1. **Jito Bundler Mode**
   - Atomic transaction bundles for MEV protection
   - All operations in a single, protected bundle
   - Maximum 5 transactions per bundle optimization
   - Priority fee configuration

2. **Delayed Bundle Mode**
   - Sequential transaction execution
   - Configurable delays between operations
   - Pattern avoidance for stealth launches
   - Random delay generation for organic appearance

3. **Snipe Mode**
   - Buy existing tokens without creation
   - Rapid execution for time-sensitive opportunities
   - Integrated with real-time monitoring

### 💼 Advanced Wallet Management

The letsbonk bundler includes a comprehensive wallet management system:

#### Wallet Generation
- Bulk wallet creation (up to 20 wallets)
- Secure keypair generation and storage
- Automatic wallet naming and organization
- Export/Import functionality for backup

#### SOL Distribution
- Intelligent SOL distribution algorithms
- Equal distribution across all wallets
- Reserve amount configuration for main wallet
- Gas optimization for distribution transactions
- Real-time balance monitoring

#### Wallet Operations
- Batch operations across all wallets
- Individual wallet management
- Balance consolidation features
- Transaction history tracking

### 📊 Trading Strategies

The bonkfun bundler implements multiple trading strategies:

#### Buy Operations
- Coordinated buys from multiple wallets
- Configurable buy amounts per wallet
- Slippage protection (default 50%)
- Priority fee optimization
- Transaction confirmation monitoring

#### Sell Strategies

1. **Sell All Mode**
   - Simultaneous sells from all wallets
   - Jito bundle protection
   - Maximum bundle efficiency

2. **Dev Dump Mode**
   - Transfer all tokens to main wallet
   - Single large sell transaction
   - Minimize transaction fees

3. **Delayed Sell Mode**
   - Individual wallet sells with delays
   - Pattern avoidance algorithms
   - Configurable delay ranges


## Installation

### Prerequisites

- Node.js >= 16.0.0
- npm or yarn package manager
- Solana CLI tools (for vanity address generation)
- Valid RPC endpoint access

### Step-by-Step Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/cicere/bonkfun-bundler.git
   cd bonkfun-bundler
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Install Solana CLI tools** (for vanity address feature)
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   ```

5. **Edit .env file**
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
| `RPC` | Solana RPC endpoint URL | Yes | - |
| `SECRET_KEY` | Main wallet private key | Yes | - |
| `API_KEY` | License key for activation | Yes | - |
| `DEBUG` | Enable debug logging | No | false |

### Token Metadata Configuration

Create a `tokenMetadata.json` file:

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

### Wallet Configuration

The bonkfun bundler supports flexible wallet configurations:

- **Maximum Wallets**: 20 (configurable)
- **Minimum SOL per Wallet**: 0.01 SOL
- **Distribution Options**: Equal, Custom, Percentage-based

## Usage Guide

### Starting the Bundler

```bash
# Using npm
npm start

# Using yarn
yarn start

# Using ts-node directly
npx ts-node main.ts
```

### Main Menu Navigation

Upon starting, you'll see the professional interface:

```
  ____   ____  _   _ _  __  _____ _   _ _   _ 
 |  _ \ / __ \| \ | | |/ / |  ___| | | | \ | |
 | |_) | |  | |  \| | ' /  | |_  | | | |  \| |
 |  _ <| |  | | . ` |  <   |  _| | |_| | . ` |
 | |_) | |__| | |\  | . \ _| |   |  _  | |\  |
 |____/ \____/|_| \_|_|\_(_)_|   |_| |_|_| \_|

═══════════════════════════════════════════════════
  solana-scripts.com
  discord.gg/solana-scripts
═══════════════════════════════════════════════════

  Main Wallet
  ──────────────────────────────────────────────────
  Address: 5kYJ8n6N...9mKQPaUX
  Balance: 10.5420 SOL

  Menu Options
  ──────────────────────────────────────────────────

  [1] Wallet Management
      └─ Generate and manage multiple wallets

  [2] Launch UI
      └─ Launch tokens with various strategies

  [3] Sell UI
      └─ Sell tokens and retrieve funds

  ──────────────────────────────────────────────────
  [exit] Quit application

  Select option: 
```

### Token Launch Strategies

#### 1. Jito Bundler Launch

The most secure launch method using MEV protection:

```typescript
// Automatic process flow:
1. Vanity address generation (optional)
2. Token metadata creation
3. Token creation transaction
4. Multi-wallet buy transactions
5. All bundled in single Jito bundle
```

**Configuration Options:**
- Vanity address: Yes/No
- Buy amount per wallet: 0.01 - 10 SOL
- Jito tip amount: 0.0001 - 0.1 SOL

#### 2. Delayed Bundle Launch

For organic-looking launches:

```typescript
// Sequential execution with delays:
1. Token creation
2. Wait random delay (5-30 seconds)
3. First wallet buy
4. Wait random delay
5. Continue for all wallets
```

**Delay Configuration:**
- Minimum delay: 5 seconds
- Maximum delay: 30 seconds
- Random distribution

#### 3. Snipe Existing Token

For buying already launched tokens:

```typescript
// Rapid execution mode:
1. Input token address
2. Configure buy amounts
3. Execute coordinated buys
4. Monitor confirmation
```

### Wallet Management

#### Creating New Wallets

1. Select "Wallet Management" from main menu
2. Choose "Generate Wallets"
3. Enter number of wallets (1-20)
4. Wallets are automatically generated and saved

#### Distributing SOL

1. Select "Distribute SOL"
2. Enter total amount to distribute
3. Choose distribution method:
   - Equal: Divides equally among all wallets
   - Custom: Set specific amounts per wallet
4. Confirm and execute distribution

#### Viewing Wallet Information

The wallet manager displays:
- Wallet addresses (truncated for security)
- SOL balances
- Token balances
- Recent transaction history

### Trading Operations

#### Buy Configuration

```json
{
  "buyAmount": 0.1,
  "slippage": 50,
  "priorityFee": 0.0001,
  "confirmations": "confirmed"
}
```

#### Monitoring Transactions

The bundler provides real-time feedback:
- Transaction signatures
- Confirmation status
- Success/failure notifications
- Balance updates

### Exit Strategies

#### 1. Sell All Tokens

Executes coordinated sells across all wallets:

```bash
Preparing sell transactions...
✓ Wallet 1: 1000 TOKENS ready
✓ Wallet 2: 1000 TOKENS ready
...
Bundling 5 transactions...
✓ Bundle submitted: 5xKp9N...
```

#### 2. Dev Dump Strategy

Consolidates before selling:

```bash
Transferring tokens to main wallet...
✓ Transfer from Wallet 1: 2xNp4K...
✓ Transfer from Wallet 2: 3mKL9X...
...
Executing final sell...
✓ Sold 5000 TOKENS: 7yHN3P...
```

#### 3. SOL Recovery

Closes token accounts and recovers rent:

```bash
Retrieving SOL from token accounts...
✓ Closed account: AtokenAddress1...
✓ Closed account: AtokenAddress2...
...
Total recovered: 0.05 SOL
```

## Advanced Features

### Vanity Address Generation

The bonkfun bundler includes state-of-the-art vanity address generation:

#### Technical Implementation

```typescript
// Native solana-keygen integration
const generateVanityAddress = async (pattern: string) => {
  // Utilizes all CPU cores
  // Implements retry logic
  // Provides time estimates
  // Handles Windows/Linux/Mac compatibility
};
```

#### Performance Metrics

- **2-character suffix**: ~5-30 seconds
- **3-character suffix**: ~30 seconds - 2 minutes  
- **4-character suffix**: ~1-10 minutes

### Transaction Optimization

#### Bundle Optimization

The bundler intelligently groups transactions:

```typescript
// Maximum efficiency algorithm
const optimizeBundle = (transactions: Transaction[]) => {
  // Groups up to 5 transactions
  // Calculates optimal fees
  // Minimizes total cost
  // Maximizes success rate
};
```

#### Priority Fee Management

Dynamic fee calculation based on:
- Network congestion
- Transaction urgency
- Bundle size
- Historical success rates

### Error Handling & Recovery

Comprehensive error handling ensures reliability:

1. **Transaction Failures**
   - Automatic retry with exponential backoff
   - Alternative RPC endpoint fallback
   - Detailed error logging

2. **Network Issues**
   - Connection pooling
   - Timeout management
   - Graceful degradation

3. **Wallet Errors**
   - Balance verification
   - Insufficient funds warnings
   - Account validation

## API Reference

### Core Modules

#### BonkfunSDK

```typescript
interface BonkfunSDK {
  createToken(metadata: TokenMetadata): Promise<Transaction>;
  buyToken(mint: PublicKey, amount: number): Promise<Transaction>;
  sellToken(mint: PublicKey, amount: number): Promise<Transaction>;
  getTokenInfo(mint: PublicKey): Promise<TokenInfo>;
}
```

#### WalletManager

```typescript
class WalletManager {
  generateWallets(count: number): Keypair[];
  distributeSOL(amount: number, method: DistributionMethod): Promise<void>;
  getBalances(): Promise<WalletBalance[]>;
  exportWallets(): WalletExport;
  importWallets(data: WalletExport): void;
}
```

#### LaunchManager

```typescript
class LaunchManager {
  launchWithJito(config: LaunchConfig): Promise<LaunchResult>;
  launchWithDelay(config: LaunchConfig): Promise<LaunchResult>;
  snipeToken(mint: PublicKey, config: SnipeConfig): Promise<SnipeResult>;
}
```

### Configuration Types

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

## Security Considerations

### Private Key Management

- **Never share your private keys**
- Store keys in environment variables
- Use encrypted storage for production
- Implement key rotation policies

### Transaction Security

- All sensitive operations use Jito bundles
- Implements slippage protection
- Validates all addresses before operations
- Monitors for suspicious activity

### Best Practices

1. **Use a dedicated wallet** for bundler operations
2. **Keep minimal SOL** in operational wallets
3. **Regular backups** of wallet configurations
4. **Monitor transactions** for anomalies
5. **Update regularly** for security patches

## Performance Optimization

### System Requirements

- **CPU**: Multi-core recommended for vanity generation
- **RAM**: 4GB minimum, 8GB recommended
- **Network**: Stable connection with low latency
- **Storage**: 500MB free space

### Optimization Tips

1. **RPC Endpoint Selection**
   - Use premium RPC services for reliability
   - Configure multiple endpoints for fallback
   - Monitor RPC performance metrics

2. **Transaction Batching**
   - Group related operations
   - Utilize maximum bundle size (5 transactions)
   - Optimize fee structures

3. **Wallet Management**
   - Maintain optimal wallet count (10-15)
   - Regular consolidation of small balances
   - Efficient SOL distribution

## Troubleshooting

### Common Issues

#### "Vanity address generation timeout"
- Increase timeout for longer patterns
- Verify Solana CLI tools installation
- Check CPU availability

#### "Transaction failed"
- Verify RPC endpoint status
- Check wallet balances
- Review slippage settings
- Increase priority fees

#### "Bundle submission error"
- Confirm Jito endpoint availability
- Verify tip amount is sufficient
- Check bundle size limits

### Debug Mode

Enable detailed logging:

```env
DEBUG=true
```

Debug output includes:
- Transaction construction details
- RPC communication logs
- Bundle composition information
- Timing metrics

## Contributing

We welcome contributions to the bonkfun bundler project!

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Install development dependencies
4. Run tests: `npm test`
5. Submit pull request

### Code Style

- TypeScript strict mode
- ESLint configuration
- Prettier formatting
- Comprehensive comments



## Support

### Documentation
- Full documentation: [docs.solana-scripts.com](https://docs.solana-scripts.com)

### Community
- Discord: [discord.gg/solana-scripts](https://discord.gg/solana-scripts)
- Twitter: [@benoriz0](https://x.com/benoriz0)
- Telegram: [t.me/benorizz0](https://t.me/benorizz0)


---

**Disclaimer**: The bonkfun bundler is a powerful tool designed for legitimate token operations on [letsbonk.fun](https://letsbonk.fun/). Users are responsible for compliance with all applicable laws and platform terms of service. The developers assume no liability for misuse of this software.

---

*Built with ❤️ for the Solana community by [solana-scripts.com](https://solana-scripts.com)* 
