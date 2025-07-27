const { Transaction, TransactionInstruction, PublicKey, ComputeBudgetProgram, VersionedTransaction, TransactionMessage } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createCloseAccountInstruction } = require('@solana/spl-token');
const BN = require('bn.js');
const axios = require('axios');
const bs58 = require('bs58');

const BONKFUN_PROGRAM = new PublicKey("BFUNm9sH9RP3iKxwbJXVQjvTqDxj8YpvngCBvqxoWZRz");
const RAYDIUM_PROGRAM_V2 = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
const RAYDIUM_AUTHORITY = new PublicKey("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");

const DISCRIMINATORS = {
    BONKFUN_SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
    BONKFUN_BUY: Buffer.from([66, 0, 225, 24, 214, 117, 224, 36]),
    RAYDIUM_SWAP: Buffer.from([143, 190, 90, 218, 196, 30, 51, 222])
};

class TradingEngine {
    constructor(connection, walletManager) {
        this.connection = connection;
        this.walletManager = walletManager;
        this.poolCache = new Map();
        this.priceCache = new Map();
        this.migrationCache = new Map();
        this.jitoTipAccounts = [
            "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
            "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
            "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
            "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt"
        ];
    }

    async checkMigration(tokenMint) {
        const mintStr = tokenMint.toString();
        
        if (this.migrationCache.has(mintStr)) {
            return this.migrationCache.get(mintStr);
        }

        try {
            const response = await axios({
                method: 'post',
                url: 'https://api.mainnet-beta.solana.com',
                headers: { 'Content-Type': 'application/json' },
                data: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getProgramAccounts',
                    params: [
                        RAYDIUM_PROGRAM_V2.toString(),
                        {
                            encoding: 'base64',
                            filters: [
                                { dataSize: 680 },
                                { 
                                    memcmp: { 
                                        offset: 264,
                                        bytes: tokenMint.toString()
                                    }
                                }
                            ]
                        }
                    ]
                }
            });

            const hasPools = response.data.result && response.data.result.length > 0;
            this.migrationCache.set(mintStr, hasPools);
            
            setTimeout(() => this.migrationCache.delete(mintStr), 300000);
            
            return hasPools;
        } catch (error) {
            return false;
        }
    }

    async getPoolInfo(tokenMint) {
        const cacheKey = `pool_${tokenMint.toString()}`;
        
        if (this.poolCache.has(cacheKey)) {
            return this.poolCache.get(cacheKey);
        }

        try {
            const isMigrated = await this.checkMigration(tokenMint);
            
            if (isMigrated) {
                return this.getRaydiumPoolInfo(tokenMint);
            } else {
                return this.getBonkfunPoolInfo(tokenMint);
            }
        } catch (error) {
            console.error("Failed to get pool info:", error);
            return null;
        }
    }

    async getBonkfunPoolInfo(tokenMint) {
        const [poolPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool"), tokenMint.toBuffer()],
            BONKFUN_PROGRAM
        );

        const accountInfo = await this.connection.getAccountInfo(poolPda);
        if (!accountInfo) return null;

        const data = accountInfo.data;
        
        const poolInfo = {
            address: poolPda,
            mint: tokenMint,
            poolType: 'bonkfun',
            virtualSolReserves: new BN(data.slice(8, 16), 'le'),
            virtualTokenReserves: new BN(data.slice(16, 24), 'le'),
            realSolReserves: new BN(data.slice(24, 32), 'le'),
            realTokenReserves: new BN(data.slice(32, 40), 'le'),
            tokenTotalSupply: new BN(data.slice(40, 48), 'le'),
            complete: data[48] === 1
        };

        this.poolCache.set(`pool_${tokenMint.toString()}`, poolInfo);
        return poolInfo;
    }

    async getRaydiumPoolInfo(tokenMint) {
        const response = await axios({
            method: 'post',
            url: 'https://api.mainnet-beta.solana.com',
            data: {
                jsonrpc: '2.0',
                id: 1,
                method: 'getProgramAccounts',
                params: [
                    RAYDIUM_PROGRAM_V2.toString(),
                    {
                        encoding: 'base64+zstd',
                        filters: [
                            { dataSize: 680 },
                            { memcmp: { offset: 264, bytes: tokenMint.toString() } }
                        ]
                    }
                ]
            }
        });

        if (!response.data.result || response.data.result.length === 0) {
            return null;
        }

        const poolAccount = response.data.result[0];
        const poolData = Buffer.from(poolAccount.account.data[0], 'base64');
        
        const poolInfo = {
            address: new PublicKey(poolAccount.pubkey),
            poolType: 'raydium',
            configId: new PublicKey(poolData.slice(8, 40)),
            poolCreator: new PublicKey(poolData.slice(40, 72)),
            vaultA: new PublicKey(poolData.slice(72, 104)),
            vaultB: new PublicKey(poolData.slice(104, 136)),
            mintA: new PublicKey(poolData.slice(264, 296)),
            mintB: new PublicKey(poolData.slice(296, 328)),
            observationId: new PublicKey(poolData.slice(424, 456))
        };

        return poolInfo;
    }

    async sellAll(wallets, tokenMint, percentage = 100, options = {}) {
        const { 
            bundleSize = 5, 
            jitoTip = 0.001,
            slippage = 50,
            computeUnits = 400000
        } = options;

        const sellInstructions = [];
        const sellWallets = [];

        for (const wallet of wallets) {
            const keypair = wallet.keypair || wallet;
            const tokenAccount = await getAssociatedTokenAddress(tokenMint, keypair.publicKey);
            
            try {
                const balance = await this.connection.getTokenAccountBalance(tokenAccount);
                const amount = new BN(balance.value.amount);
                
                if (amount.gt(new BN(0))) {
                    const sellAmount = amount.mul(new BN(percentage)).div(new BN(100));
                    const instructions = await this.buildSellInstructions(
                        keypair,
                        tokenMint,
                        sellAmount,
                        slippage
                    );
                    
                    sellInstructions.push(instructions);
                    sellWallets.push(keypair);
                }
            } catch (error) {
                continue;
            }
        }

        if (sellInstructions.length === 0) {
            throw new Error("No tokens to sell");
        }

        return this.executeBundledTransactions(
            sellInstructions,
            sellWallets,
            bundleSize,
            jitoTip,
            computeUnits
        );
    }

    async buildSellInstructions(keypair, tokenMint, amount, slippage = 50) {
        const isMigrated = await this.checkMigration(tokenMint);
        const poolInfo = await this.getPoolInfo(tokenMint);
        
        if (!poolInfo) {
            throw new Error("Pool not found");
        }

        const instructions = [];
        
        instructions.push(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })
        );

        const tokenAccount = await getAssociatedTokenAddress(tokenMint, keypair.publicKey);
        const wsolAccount = await getAssociatedTokenAddress(
            new PublicKey("So11111111111111111111111111111111111111112"),
            keypair.publicKey
        );

        if (isMigrated) {
            const sellIx = await this.buildRaydiumSellInstruction(
                keypair,
                tokenMint,
                amount,
                poolInfo,
                tokenAccount,
                wsolAccount,
                slippage
            );
            instructions.push(sellIx);
        } else {
            const sellIx = await this.buildBonkfunSellInstruction(
                keypair,
                tokenMint,
                amount,
                poolInfo,
                tokenAccount,
                slippage
            );
            instructions.push(sellIx);
        }

        instructions.push(
            createCloseAccountInstruction(
                tokenAccount,
                keypair.publicKey,
                keypair.publicKey
            )
        );

        const wsolExists = await this.connection.getAccountInfo(wsolAccount);
        if (wsolExists) {
            instructions.push(
                createCloseAccountInstruction(
                    wsolAccount,
                    keypair.publicKey,
                    keypair.publicKey
                )
            );
        }

        return instructions;
    }

    buildBonkfunSellInstruction(keypair, tokenMint, amount, poolInfo, tokenAccount, slippage) {
        const minSolOut = this.calculateMinSolOut(amount, poolInfo, slippage);
        
        const data = Buffer.concat([
            DISCRIMINATORS.BONKFUN_SELL,
            amount.toBuffer('le', 8),
            minSolOut.toBuffer('le', 8)
        ]);

        const [bondingCurve] = PublicKey.findProgramAddressSync(
            [Buffer.from("bonding_curve"), tokenMint.toBuffer()],
            BONKFUN_PROGRAM
        );

        const [globalState] = PublicKey.findProgramAddressSync(
            [Buffer.from("global")],
            BONKFUN_PROGRAM
        );

        const keys = [
            { pubkey: globalState, isSigner: false, isWritable: false },
            { pubkey: bondingCurve, isSigner: false, isWritable: true },
            { pubkey: tokenMint, isSigner: false, isWritable: false },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: tokenAccount, isSigner: false, isWritable: true },
            { pubkey: poolInfo.address, isSigner: false, isWritable: true },
            { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
        ];

        return new TransactionInstruction({
            programId: BONKFUN_PROGRAM,
            keys,
            data
        });
    }

    async buildRaydiumSellInstruction(keypair, tokenMint, amount, poolInfo, tokenAccount, wsolAccount, slippage) {
        const minOut = this.calculateRaydiumMinOut(amount, poolInfo, slippage);
        
        const data = Buffer.concat([
            DISCRIMINATORS.RAYDIUM_SWAP,
            amount.toBuffer('le', 8),
            minOut.toBuffer('le', 8)
        ]);

        const inputVault = poolInfo.mintA.equals(tokenMint) ? poolInfo.vaultA : poolInfo.vaultB;
        const outputVault = poolInfo.mintA.equals(tokenMint) ? poolInfo.vaultB : poolInfo.vaultA;

        const keys = [
            { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
            { pubkey: RAYDIUM_AUTHORITY, isSigner: false, isWritable: false },
            { pubkey: poolInfo.configId, isSigner: false, isWritable: false },
            { pubkey: poolInfo.address, isSigner: false, isWritable: true },
            { pubkey: tokenAccount, isSigner: false, isWritable: true },
            { pubkey: wsolAccount, isSigner: false, isWritable: true },
            { pubkey: inputVault, isSigner: false, isWritable: true },
            { pubkey: outputVault, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: tokenMint, isSigner: false, isWritable: false },
            { pubkey: new PublicKey("So11111111111111111111111111111111111111112"), isSigner: false, isWritable: false },
            { pubkey: poolInfo.observationId, isSigner: false, isWritable: true }
        ];

        return new TransactionInstruction({
            programId: RAYDIUM_PROGRAM_V2,
            keys,
            data
        });
    }

    calculateMinSolOut(tokenAmount, poolInfo, slippageBps) {
        const virtualSol = poolInfo.virtualSolReserves;
        const virtualToken = poolInfo.virtualTokenReserves;
        
        const k = virtualSol.mul(virtualToken);
        const newTokenReserve = virtualToken.add(tokenAmount);
        const newSolReserve = k.div(newTokenReserve);
        const solOut = virtualSol.sub(newSolReserve);
        
        const slippageMultiplier = new BN(10000 - slippageBps);
        const minSolOut = solOut.mul(slippageMultiplier).div(new BN(10000));
        
        return minSolOut;
    }

    calculateRaydiumMinOut(amount, poolInfo, slippageBps) {
        return amount.mul(new BN(10000 - slippageBps)).div(new BN(10000));
    }

    async executeBundledTransactions(instructionSets, signers, bundleSize, jitoTip, computeUnits) {
        const bundles = [];
        const { blockhash } = await this.connection.getLatestBlockhash();
        
        for (let i = 0; i < instructionSets.length; i += bundleSize) {
            const bundleInstructions = instructionSets.slice(i, i + bundleSize);
            const bundleSigners = signers.slice(i, i + bundleSize);
            
            const transactions = [];
            
            for (let j = 0; j < bundleInstructions.length; j++) {
                const message = new TransactionMessage({
                    payerKey: bundleSigners[j].publicKey,
                    recentBlockhash: blockhash,
                    instructions: bundleInstructions[j]
                }).compileToV0Message();
                
                const tx = new VersionedTransaction(message);
                tx.sign([bundleSigners[j]]);
                transactions.push(tx);
            }
            
            if (jitoTip > 0) {
                const tipAccount = this.jitoTipAccounts[Math.floor(Math.random() * this.jitoTipAccounts.length)];
                const tipIx = SystemProgram.transfer({
                    fromPubkey: bundleSigners[0].publicKey,
                    toPubkey: new PublicKey(tipAccount),
                    lamports: jitoTip * 1e9
                });
                
                const tipMessage = new TransactionMessage({
                    payerKey: bundleSigners[0].publicKey,
                    recentBlockhash: blockhash,
                    instructions: [tipIx]
                }).compileToV0Message();
                
                const tipTx = new VersionedTransaction(tipMessage);
                tipTx.sign([bundleSigners[0]]);
                transactions.push(tipTx);
            }
            
            bundles.push(transactions);
        }
        
        return this.sendJitoBundles(bundles);
    }

    async sendJitoBundles(bundles) {
        const results = [];
        
        for (const bundle of bundles) {
            try {
                const serializedTransactions = bundle.map(tx => bs58.encode(tx.serialize()));
                
                const response = await axios.post(
                    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
                    {
                        jsonrpc: "2.0",
                        id: 1,
                        method: "sendBundle",
                        params: [serializedTransactions]
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                results.push(response.data);
            } catch (error) {
                results.push({ error: error.message });
            }
        }
        
        return results;
    }

    async devDump(wallets, mainWallet, tokenMint, percentage = 100) {
        const transferInstructions = [];
        const transferSigners = [];
        
        for (const wallet of wallets) {
            const keypair = wallet.keypair || wallet;
            const tokenAccount = await getAssociatedTokenAddress(tokenMint, keypair.publicKey);
            const mainTokenAccount = await getAssociatedTokenAddress(tokenMint, mainWallet.publicKey);
            
            try {
                const balance = await this.connection.getTokenAccountBalance(tokenAccount);
                const amount = new BN(balance.value.amount);
                
                if (amount.gt(new BN(0))) {
                    const transferAmount = amount.mul(new BN(percentage)).div(new BN(100));
                    
                    const instructions = [
                        ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
                        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
                    ];
                    
                    const tokenAccExists = await this.connection.getAccountInfo(mainTokenAccount);
                    if (!tokenAccExists) {
                        instructions.push(
                            createAssociatedTokenAccountInstruction(
                                mainWallet.publicKey,
                                mainTokenAccount,
                                mainWallet.publicKey,
                                tokenMint
                            )
                        );
                    }
                    
                    const transferIx = Token.createTransferInstruction(
                        TOKEN_PROGRAM_ID,
                        tokenAccount,
                        mainTokenAccount,
                        keypair.publicKey,
                        [],
                        transferAmount.toNumber()
                    );
                    
                    instructions.push(transferIx);
                    transferInstructions.push(instructions);
                    transferSigners.push(keypair);
                }
            } catch (error) {
                continue;
            }
        }
        
        await this.executeBundledTransactions(transferInstructions, transferSigners, 5, 0, 100000);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return this.sellAll([mainWallet], tokenMint, percentage);
    }

    async individualSell(wallet, tokenMint, percentage) {
        const keypair = wallet.keypair || wallet;
        const tokenAccount = await getAssociatedTokenAddress(tokenMint, keypair.publicKey);
        
        const balance = await this.connection.getTokenAccountBalance(tokenAccount);
        const amount = new BN(balance.value.amount);
        
        if (amount.lte(new BN(0))) {
            throw new Error("No tokens to sell");
        }
        
        const sellAmount = amount.mul(new BN(percentage)).div(new BN(100));
        const instructions = await this.buildSellInstructions(keypair, tokenMint, sellAmount, 50);
        
        const { blockhash } = await this.connection.getLatestBlockhash();
        const message = new TransactionMessage({
            payerKey: keypair.publicKey,
            recentBlockhash: blockhash,
            instructions
        }).compileToV0Message();
        
        const tx = new VersionedTransaction(message);
        tx.sign([keypair]);
        
        const signature = await this.connection.sendTransaction(tx, {
            skipPreflight: false,
            preflightCommitment: 'processed'
        });
        
        return signature;
    }

    async delayedSell(wallets, tokenMint, minDelay, maxDelay, percentage) {
        const results = [];
        
        for (let i = 0; i < wallets.length; i++) {
            const delay = Math.floor(Math.random() * (maxDelay - minDelay) + minDelay) * 1000;
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
                const sig = await this.individualSell(wallets[i], tokenMint, percentage);
                results.push({ wallet: i, signature: sig, status: 'success' });
            } catch (error) {
                results.push({ wallet: i, error: error.message, status: 'failed' });
            }
            
            console.log(`Sold from wallet ${i + 1}/${wallets.length}`);
        }
        
        return results;
    }
}

module.exports = { TradingEngine }; 
