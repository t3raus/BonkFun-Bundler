const { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionMessage, VersionedTransaction, TransactionInstruction } = require('@solana/web3.js');
const { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const chalk = require('chalk');
const prompt = require('prompt-sync')();
const bs58 = require('bs58');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const BN = require('bn.js');
const FormData = require('form-data');

const CONFIG = {
    RPC_ENDPOINT: process.env.RPC_ENDPOINT || "https://solana-mainnet.g.alchemy.com/v2/",
    MAX_WALLETS: 20,
    JITO_TIP: 0.00095,
    PRIORITY_FEE: 0.000125,
    COMPUTE_UNITS: 200000,
    SLIPPAGE: 50,
    RETRY_DELAY: 1000,
    BUNDLE_SIZE: 5
};

const PROGRAMS = {
    BONKFUN: new PublicKey("BFUNm9sH9RP3iKxwbJXVQjvTqDxj8YpvngCBvqxoWZRz"),
    RAYDIUM_CPMM: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
    COMPUTE_BUDGET: new PublicKey("ComputeBudget111111111111111111111111111111"),
    METADATA: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
    JITO_TIP: [
        "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
        "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
        "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY"
    ]
};

class BonkfunBundler {
    constructor() {
        this.connection = new Connection(CONFIG.RPC_ENDPOINT + process.env.ALCHEMY_KEY);
        this.wallets = [];
        this.initialized = false;
        this.lookupTables = [];
        this.poolCache = new Map();
        this.nonceAccounts = new Map();
        this.priorityQueue = [];
    }

    async initialize() {
        if (this.initialized) return;
        
        const blockHeight = await this.connection.getBlockHeight();
        const slot = await this.connection.getSlot();
        this.currentEpoch = await this.connection.getEpochInfo();
        
        this.lookupTables = await this.fetchLookupTables();
        await this.loadWalletState();
        
        this.initialized = true;
    }

    async fetchLookupTables() {
        const tables = [
            "8KLCZX6bFJxYYyH9vSXvH1XfSHWqyLUJxRkVNmjRmKGi",
            "7Uu3DqYjc7PYFJxYYNkRbJq5fAQtB9aYrWoZZZtxMXQs"
        ];
        
        const lookups = [];
        for (const table of tables) {
            try {
                const info = await this.connection.getAddressLookupTable(new PublicKey(table));
                if (info.value) lookups.push(info.value);
            } catch {}
        }
        return lookups;
    }

    async loadWalletState() {
        try {
            const data = fs.readFileSync('currentKeypair.json', 'utf8');
            const parsed = JSON.parse(data);
            
            this.wallets = parsed.map(w => ({
                publicKey: new PublicKey(w.publicKey),
                secretKey: bs58.decode(w.secretKey)
            }));
            
            const mainData = fs.readFileSync('.cache/main.json', 'utf8');
            const mainParsed = JSON.parse(mainData);
            this.mainWallet = Keypair.fromSecretKey(new Uint8Array(mainParsed));
        } catch (e) {
            this.wallets = [];
        }
    }

    async launchToken(metadata) {
        await this.initialize();
        
        const { tokenName, tokenSymbol, description, file, twitter, telegram, website, jitoTipAmtInput } = metadata;
        
        const mintKeypair = await this.generateVanityAddress(tokenSymbol.toLowerCase());
        const metadataUri = await this.uploadMetadata({ ...metadata, mint: mintKeypair.publicKey.toString() });
        
        const poolId = this.derivePoolPda(mintKeypair.publicKey);
        const [configId] = PublicKey.findProgramAddressSync(
            [Buffer.from("launch_config"), PROGRAMS.BONKFUN.toBuffer()],
            PROGRAMS.BONKFUN
        );
        
        const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
        const nameBuffer = Buffer.alloc(32);
        nameBuffer.write(tokenName);
        const symbolBuffer = Buffer.alloc(8);
        symbolBuffer.write(tokenSymbol);
        
        const data = Buffer.concat([
            discriminator,
            nameBuffer,
            symbolBuffer,
            Buffer.from(metadataUri, 'utf8')
        ]);
        
        const accounts = this.buildLaunchAccounts(mintKeypair.publicKey, poolId, configId);
        const ix = {
            programId: PROGRAMS.BONKFUN,
            keys: accounts,
            data
        };
        
        const { blockhash } = await this.connection.getLatestBlockhash();
        const tx = new Transaction().add(ix);
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.mainWallet.publicKey;
        tx.sign(this.mainWallet, mintKeypair);
        
        return { tx, mintKeypair };
    }

    buildLaunchAccounts(mint, poolId, configId) {
        const [authority] = PublicKey.findProgramAddressSync(
            [Buffer.from("authority")],
            PROGRAMS.BONKFUN
        );
        
        const [mintAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), mint.toBuffer()],
            PROGRAMS.BONKFUN
        );
        
        return [
            { pubkey: this.mainWallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: mint, isSigner: true, isWritable: true },
            { pubkey: poolId, isSigner: false, isWritable: true },
            { pubkey: configId, isSigner: false, isWritable: false },
            { pubkey: authority, isSigner: false, isWritable: false },
            { pubkey: mintAuthority, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: PROGRAMS.METADATA, isSigner: false, isWritable: false }
        ];
    }

    async generateVanityAddress(suffix) {
        const start = Date.now();
        let attempts = 0;
        
        while (true) {
            attempts++;
            const keypair = Keypair.generate();
            const address = keypair.publicKey.toString();
            
            if (address.toLowerCase().endsWith(suffix)) {
                console.log(chalk.green(`Found vanity address after ${attempts} attempts`));
                return keypair;
            }
            
            if (Date.now() - start > 30000) {
                return keypair;
            }
        }
    }

    async createWallets(count) {
        if (count > CONFIG.MAX_WALLETS) {
            throw new Error(`Maximum ${CONFIG.MAX_WALLETS} wallets allowed`);
        }
        
        const wallets = [];
        const mnemonics = [];
        
        for (let i = 0; i < count; i++) {
            const seed = crypto.randomBytes(32);
            const keypair = Keypair.fromSeed(seed);
            
            wallets.push({
                index: i,
                publicKey: keypair.publicKey.toString(),
                secretKey: bs58.encode(keypair.secretKey)
            });
            
            mnemonics.push(seed.toString('hex'));
        }
        
        fs.writeFileSync('currentKeypair.json', JSON.stringify(wallets, null, 2));
        fs.writeFileSync('.cache/mnemonics.json', JSON.stringify(mnemonics, null, 2));
        
        this.wallets = wallets.map(w => ({
            publicKey: new PublicKey(w.publicKey),
            secretKey: bs58.decode(w.secretKey)
        }));
        
        console.log(chalk.green(`Created ${count} wallets successfully`));
        return wallets.map(w => w.publicKey);
    }

    async distributeSol(totalAmount) {
        await this.initialize();
        
        const perWallet = Math.floor((totalAmount * 0.97) / this.wallets.length * 1e9);
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        
        const instructions = [];
        
        const computeBudgetIx = {
            programId: PROGRAMS.COMPUTE_BUDGET,
            data: Buffer.from([0, 32, 161, 7, 0, 0, 0, 0, 0]),
            keys: []
        };
        
        const priorityFeeIx = {
            programId: PROGRAMS.COMPUTE_BUDGET,
            data: Buffer.from([0, 64, 0, 0, 0, 0, 0, 0, 0]),
            keys: []
        };
        
        instructions.push(computeBudgetIx, priorityFeeIx);
        
        for (const wallet of this.wallets) {
            const transferIx = SystemProgram.transfer({
                fromPubkey: this.mainWallet.publicKey,
                toPubkey: wallet.publicKey,
                lamports: perWallet
            });
            instructions.push(transferIx);
        }
        
        const messageV0 = new TransactionMessage({
            payerKey: this.mainWallet.publicKey,
            recentBlockhash: blockhash,
            instructions
        }).compileToV0Message(this.lookupTables);
        
        const tx = new VersionedTransaction(messageV0);
        tx.sign([this.mainWallet]);
        
        const signature = await this.connection.sendTransaction(tx, {
            skipPreflight: true,
            maxRetries: 3
        });
        
        await this.connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        });
        
        console.log(chalk.green(`Distributed ${totalAmount} SOL to ${this.wallets.length} wallets`));
        return signature;
    }

    async executeSwaps(mintAddress, amountPerWallet, mode = 1) {
        await this.initialize();
        
        const mint = new PublicKey(mintAddress);
        const poolInfo = await this.getPoolInfo(mint);
        
        if (!poolInfo) throw new Error("Pool not found");
        
        const transactions = [];
        const signers = [];
        
        for (let i = 0; i < this.wallets.length; i++) {
            const wallet = this.wallets[i];
            const keypair = Keypair.fromSecretKey(wallet.secretKey);
            
            const buyIx = await this.buildBuyInstruction(keypair, mint, amountPerWallet, poolInfo);
            
            if (mode === 1 && transactions.length < CONFIG.BUNDLE_SIZE) {
                if (!transactions[0]) {
                    transactions[0] = this.createBundleTransaction();
                }
                transactions[0].instructions.push(buyIx);
                signers.push(keypair);
            } else {
                const tx = this.createBundleTransaction();
                tx.instructions.push(buyIx);
                transactions.push(tx);
                signers.push([keypair]);
            }
        }
        
        if (mode === 1) {
            return this.sendJitoBundle(transactions, signers);
        } else {
            return this.sendDelayedTransactions(transactions, signers);
        }
    }

    createBundleTransaction() {
        return {
            instructions: [
                {
                    programId: PROGRAMS.COMPUTE_BUDGET,
                    data: Buffer.from([2, 64, 66, 15, 0, 0, 0, 0, 0]),
                    keys: []
                },
                {
                    programId: PROGRAMS.COMPUTE_BUDGET,
                    data: Buffer.from([3, 160, 134, 1, 0, 0, 0, 0, 0]),
                    keys: []
                }
            ],
            signers: []
        };
    }

    async checkMigration(mintAddress) {
        try {
            const response = await axios.post(
                'https://api.mainnet-beta.solana.com',
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getProgramAccounts',
                    params: [
                        PROGRAMS.RAYDIUM_CPMM.toString(),
                        {
                            filters: [
                                { dataSize: 680 },
                                { memcmp: { offset: 72, bytes: mintAddress } }
                            ]
                        }
                    ]
                }
            );
            
            return response.data.result.length > 0;
        } catch {
            return false;
        }
    }

    async sellTokens(mintAddress, walletIndices, percentage = 100) {
        await this.initialize();
        
        const mint = new PublicKey(mintAddress);
        const isMigrated = await this.checkMigration(mintAddress);
        
        const walletsToSell = walletIndices ? 
            walletIndices.map(i => this.wallets[i]) : 
            this.wallets;
        
        const transactions = [];
        
        for (const wallet of walletsToSell) {
            const keypair = Keypair.fromSecretKey(wallet.secretKey);
            const tokenAccount = await getAssociatedTokenAddress(mint, keypair.publicKey);
            
            try {
                const balance = await this.connection.getTokenAccountBalance(tokenAccount);
                const sellAmount = Math.floor(Number(balance.value.amount) * (percentage / 100));
                
                if (sellAmount > 0) {
                    const sellIx = isMigrated ? 
                        await this.buildRaydiumSellInstruction(keypair, mint, sellAmount) :
                        await this.buildBonkfunSellInstruction(keypair, mint, sellAmount);
                    
                    transactions.push({ instruction: sellIx, signer: keypair });
                }
            } catch (e) {
                continue;
            }
        }
        
        return this.executeSellTransactions(transactions);
    }

    async buildRaydiumSellInstruction(keypair, mint, amount) {
        const poolInfo = await this.getRaydiumPoolInfo(mint);
        
        const discriminator = Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]);
        const amountBuffer = Buffer.alloc(8);
        amountBuffer.writeBigUInt64LE(BigInt(amount));
        const minOutBuffer = Buffer.alloc(8);
        
        const data = Buffer.concat([discriminator, amountBuffer, minOutBuffer]);
        
        return {
            programId: PROGRAMS.RAYDIUM_CPMM,
            keys: this.buildRaydiumSwapAccounts(keypair.publicKey, mint, poolInfo),
            data
        };
    }

    derivePoolPda(mint) {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool"), mint.toBuffer()],
            PROGRAMS.BONKFUN
        );
        return pda;
    }

    async buildBuyInstruction(keypair, mint, amount, poolInfo) {
        const data = Buffer.concat([
            Buffer.from([66, 0, 225, 24, 214, 117, 224, 36]),
            new BN(amount * 1e9).toBuffer('le', 8),
            new BN(0).toBuffer('le', 8)
        ]);

        const tokenAccount = await getAssociatedTokenAddress(mint, keypair.publicKey);
        
        const keys = [
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: poolInfo.address, isSigner: false, isWritable: true },
            { pubkey: tokenAccount, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ];

        return new TransactionInstruction({
            programId: PROGRAMS.BONKFUN,
            keys,
            data
        });
    }

    async sendJitoBundle(transactions, signers) {
        const endpoint = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
        const tipAmount = CONFIG.JITO_TIP * 1e9;
        
        const { blockhash } = await this.connection.getLatestBlockhash();
        const bundleTxs = [];

        for (let i = 0; i < transactions.length; i++) {
            const message = new TransactionMessage({
                payerKey: signers[i].publicKey,
                recentBlockhash: blockhash,
                instructions: transactions[i].instructions
            }).compileToV0Message(this.lookupTables);

            const tx = new VersionedTransaction(message);
            tx.sign([signers[i]]);
            bundleTxs.push(tx);
        }

        const tipAccount = PROGRAMS.JITO_TIP[Math.floor(Math.random() * PROGRAMS.JITO_TIP.length)];
        const tipIx = SystemProgram.transfer({
            fromPubkey: this.mainWallet.publicKey,
            toPubkey: new PublicKey(tipAccount),
            lamports: tipAmount
        });

        const tipMessage = new TransactionMessage({
            payerKey: this.mainWallet.publicKey,
            recentBlockhash: blockhash,
            instructions: [tipIx]
        }).compileToV0Message();

        const tipTx = new VersionedTransaction(tipMessage);
        tipTx.sign([this.mainWallet]);
        bundleTxs.push(tipTx);

        const serializedTxs = bundleTxs.map(tx => bs58.encode(tx.serialize()));

        const response = await axios.post(endpoint, {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [serializedTxs]
        });

        return response.data;
    }

    async uploadMetadata(metadata) {
        const formData = new FormData();
        formData.append('file', metadata.file);
        formData.append('name', metadata.tokenName);
        formData.append('symbol', metadata.tokenSymbol);
        formData.append('description', metadata.description);

        const response = await axios.post('https://ipfs.infura.io:5001/api/v0/add', formData, {
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.INFURA_PROJECT_ID + ':' + process.env.INFURA_PROJECT_SECRET).toString('base64')}`
            }
        });

        return `https://ipfs.io/ipfs/${response.data.Hash}`;
    }

    async getPoolInfo(mint) {
        const [poolPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool"), mint.toBuffer()],
            PROGRAMS.BONKFUN
        );

        const accountInfo = await this.connection.getAccountInfo(poolPda);
        if (!accountInfo) throw new Error("Pool not found");

        const data = accountInfo.data;
        return {
            address: poolPda,
            virtualSolReserves: new BN(data.slice(8, 16), 'le'),
            virtualTokenReserves: new BN(data.slice(16, 24), 'le'),
            realSolReserves: new BN(data.slice(24, 32), 'le'),
            realTokenReserves: new BN(data.slice(32, 40), 'le')
        };
    }
}

async function main() {
    console.clear();
    console.log(chalk.green(`
    ╔══════════════════════════════════════════╗
    ║         LetsBonk.fun Bundler v2.0        ║
    ╚══════════════════════════════════════════╝
    `));

    const bundler = new BonkfunBundler();
    
    const menuOptions = [
        '1. Launch Token',
        '2. Create Wallets', 
        '3. Distribute SOL',
        '4. Buy Tokens',
        '5. Sell Tokens',
        '6. Individual Wallet Sell',
        '7. Dev Dump',
        '8. Delayed Sell',
        '9. Retrieve SOL',
        '10. Export/Import Wallets',
        '11. Exit'
    ];

    while (true) {
        console.log(chalk.cyan('\nMain Menu:'));
        menuOptions.forEach(option => console.log(chalk.white(option)));
        
        const choice = prompt(chalk.yellow('\nSelect option: '));

        try {
            switch(choice) {
                case '1':
                    const tokenName = prompt('Token Name: ');
                    const tokenSymbol = prompt('Token Symbol: ');
                    const description = prompt('Description: ');
                    const file = prompt('Image path: ');
                    
                    const { tx, mintKeypair } = await bundler.launchToken({
                        tokenName,
                        tokenSymbol,
                        description,
                        file,
                        twitter: prompt('Twitter (optional): '),
                        telegram: prompt('Telegram (optional): '),
                        website: prompt('Website (optional): ')
                    });
                    
                    console.log(chalk.green(`Token launched! Mint: ${mintKeypair.publicKey.toString()}`));
                    break;

                case '2':
                    const count = parseInt(prompt('Number of wallets: '));
                    const useMnemonic = prompt('Use mnemonic? (y/n): ').toLowerCase() === 'y';
                    await bundler.createWallets(count, useMnemonic);
                    break;

                case '3':
                    const amount = parseFloat(prompt('Total SOL to distribute: '));
                    const sig = await bundler.distributeSol(amount);
                    console.log(chalk.green(`Distribution complete: ${sig}`));
                    break;

                case '4':
                    const mintAddress = prompt('Token mint address: ');
                    const perWallet = parseFloat(prompt('SOL per wallet: '));
                    const mode = parseInt(prompt('Mode (1=Bundle, 2=Sequential): '));
                    await bundler.executeSwaps(mintAddress, perWallet, mode);
                    break;

                case '5':
                    const { TradingEngine } = require('./tradingEngine');
                    const engine = new TradingEngine(bundler.connection, bundler);
                    const sellMint = prompt('Token mint: ');
                    const percentage = parseInt(prompt('Sell percentage (1-100): '));
                    await engine.sellAll(bundler.wallets, new PublicKey(sellMint), percentage);
                    break;

                case '11':
                    process.exit(0);

                default:
                    console.log(chalk.red('Invalid option'));
            }
        } catch (error) {
            console.error(chalk.red(`Error: ${error.message}`));
        }
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { BonkfunBundler }; 
