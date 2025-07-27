const { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const chalk = require('chalk');
const prompt = require('prompt-sync')();
const bs58 = require('bs58');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

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
} 
