const { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const { derivePath } = require('ed25519-hd-key');
const bip39 = require('bip39');
const crypto = require('crypto');

class WalletManager {
    constructor(connection) {
        this.connection = connection;
        this.walletFile = path.join(process.cwd(), 'currentKeypair.json');
        this.mainWalletFile = path.join(process.cwd(), '.cache', 'main.json');
        this.wallets = [];
        this.mainWallet = null;
        this.mnemonicCache = new Map();
        this.balanceCache = new Map();
        this.nonceAccounts = new Map();
        this.initializeState();
    }

    initializeState() {
        try {
            if (fs.existsSync(this.walletFile)) {
                const data = JSON.parse(fs.readFileSync(this.walletFile, 'utf8'));
                this.wallets = data;
            }
            
            if (fs.existsSync(this.mainWalletFile)) {
                const mainData = JSON.parse(fs.readFileSync(this.mainWalletFile, 'utf8'));
                this.mainWallet = Keypair.fromSecretKey(new Uint8Array(mainData));
            }
        } catch (e) {
            this.wallets = [];
        }
    }

    async createWallets(count, useMnemonic = false) {
        const wallets = [];
        const timestamp = Date.now();
        
        if (useMnemonic) {
            const mnemonic = bip39.generateMnemonic(256);
            const seed = await bip39.mnemonicToSeed(mnemonic);
            
            for (let i = 0; i < count; i++) {
                const path = `m/44'/501'/${i}'/0'`;
                const derivedSeed = derivePath(path, seed.toString('hex')).key;
                const keypair = Keypair.fromSeed(derivedSeed);
                
                wallets.push({
                    index: i,
                    publicKey: keypair.publicKey.toString(),
                    secretKey: bs58.encode(keypair.secretKey),
                    path,
                    timestamp
                });
            }
            
            this.mnemonicCache.set(timestamp, mnemonic);
        } else {
            for (let i = 0; i < count; i++) {
                const entropy = crypto.randomBytes(32);
                const keypair = Keypair.fromSeed(entropy);
                
                wallets.push({
                    index: i,
                    publicKey: keypair.publicKey.toString(),
                    secretKey: bs58.encode(keypair.secretKey),
                    timestamp
                });
            }
        }
        
        this.wallets = [...this.wallets, ...wallets];
        this.saveWalletState();
        
        return wallets;
    }

    async distributeSol(totalAmount, options = {}) {
        const { reserve = 0.05, priority = 'normal' } = options;
        
        if (!this.mainWallet) {
            const mainKeypair = await this.loadMainWallet();
            if (!mainKeypair) throw new Error("Main wallet not configured");
            this.mainWallet = mainKeypair;
        }
        
        const activeWallets = this.wallets.filter(w => !w.disabled);
        const distributionAmount = totalAmount - reserve;
        const perWallet = Math.floor((distributionAmount / activeWallets.length) * 1e9);
        
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        
        const priorityFees = {
            low: 1000,
            normal: 10000,
            high: 50000,
            ultra: 100000
        };
        
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: 200000 + (activeWallets.length * 5000)
        });
        
        const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFees[priority]
        });
        
        const instructions = [computeBudgetIx, computePriceIx];
        
        for (const wallet of activeWallets) {
            const transferIx = SystemProgram.transfer({
                fromPubkey: this.mainWallet.publicKey,
                toPubkey: new PublicKey(wallet.publicKey),
                lamports: perWallet
            });
            instructions.push(transferIx);
        }
        
        const transaction = new Transaction();
        transaction.add(...instructions);
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = this.mainWallet.publicKey;
        
        const serialized = transaction.serialize({ requireAllSignatures: false });
        if (serialized.length > 1232) {
            return this.distributeInBatches(totalAmount, options);
        }
        
        transaction.sign(this.mainWallet);
        
        const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'processed',
            maxRetries: 3
        });
        
        const confirmation = await this.connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, 'confirmed');
        
        if (confirmation.value.err) {
            throw new Error(`Distribution failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        this.updateBalanceCache();
        return signature;
    }

    async distributeInBatches(totalAmount, options) {
        const batchSize = 10;
        const signatures = [];
        const batches = [];
        
        for (let i = 0; i < this.wallets.length; i += batchSize) {
            batches.push(this.wallets.slice(i, i + batchSize));
        }
        
        const amountPerBatch = totalAmount / batches.length;
        
        for (const batch of batches) {
            const sig = await this.distributeToBatch(batch, amountPerBatch, options);
            signatures.push(sig);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        return signatures;
    }

    async getWalletBalance(walletIndex) {
        if (walletIndex >= this.wallets.length) {
            throw new Error("Invalid wallet index");
        }
        
        const wallet = this.wallets[walletIndex];
        const cacheKey = `${wallet.publicKey}_${Date.now()}`;
        
        if (this.balanceCache.has(cacheKey)) {
            return this.balanceCache.get(cacheKey);
        }
        
        const pubkey = new PublicKey(wallet.publicKey);
        const balance = await this.connection.getBalance(pubkey);
        
        const tokenAccounts = await this.connection.getTokenAccountsByOwner(pubkey, {
            programId: TOKEN_PROGRAM_ID
        });
        
        const result = {
            sol: balance / 1e9,
            tokens: tokenAccounts.value.map(account => ({
                address: account.pubkey.toString(),
                mint: account.account.data.slice(0, 32).toString('hex'),
                amount: account.account.data.readBigUInt64LE(64)
            }))
        };
        
        this.balanceCache.set(cacheKey, result);
        setTimeout(() => this.balanceCache.delete(cacheKey), 30000);
        
        return result;
    }

    async exportWallets(password) {
        const salt = crypto.randomBytes(16);
        const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
        const iv = crypto.randomBytes(16);
        
        const data = {
            wallets: this.wallets,
            mainWallet: this.mainWallet ? Array.from(this.mainWallet.secretKey) : null,
            mnemonics: Array.from(this.mnemonicCache.entries()),
            exported: new Date().toISOString(),
            version: "2.0"
        };
        
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(data), 'utf8'),
            cipher.final()
        ]);
        
        const authTag = cipher.getAuthTag();
        
        return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');
    }

    async importWallets(data, password) {
        const buffer = Buffer.from(data, 'base64');
        
        const salt = buffer.slice(0, 16);
        const iv = buffer.slice(16, 32);
        const authTag = buffer.slice(32, 48);
        const encrypted = buffer.slice(48);
        
        const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        
        const parsed = JSON.parse(decrypted.toString('utf8'));
        
        for (const wallet of parsed.wallets) {
            const keypair = Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
            if (keypair.publicKey.toString() !== wallet.publicKey) {
                throw new Error("Key verification failed");
            }
        }
        
        this.wallets = parsed.wallets;
        if (parsed.mainWallet) {
            this.mainWallet = Keypair.fromSecretKey(new Uint8Array(parsed.mainWallet));
        }
        
        this.saveWalletState();
        return this.wallets.length;
    }

    async consolidateSol(options = {}) {
        const { threshold = 0.002, keepAmount = 0.001 } = options;
        
        if (!this.mainWallet) {
            throw new Error("Main wallet not configured");
        }
        
        const transactions = [];
        const { blockhash } = await this.connection.getLatestBlockhash();
        
        for (const wallet of this.wallets) {
            const keypair = Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
            const balance = await this.connection.getBalance(keypair.publicKey);
            
            if (balance > threshold * 1e9) {
                const transferAmount = balance - (keepAmount * 1e9);
                
                const tx = new Transaction();
                tx.add(
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
                    SystemProgram.transfer({
                        fromPubkey: keypair.publicKey,
                        toPubkey: this.mainWallet.publicKey,
                        lamports: transferAmount
                    })
                );
                
                tx.recentBlockhash = blockhash;
                tx.sign(keypair);
                
                transactions.push(tx);
            }
        }
        
        const signatures = await Promise.allSettled(
            transactions.map(tx => 
                this.connection.sendRawTransaction(tx.serialize(), {
                    skipPreflight: true
                })
            )
        );
        
        return signatures.filter(r => r.status === 'fulfilled').map(r => r.value);
    }

    async generateVanityAddress(pattern, options = {}) {
        const { timeout = 300000, caseSensitive = false, position = 'end' } = options;
        const startTime = Date.now();
        let attempts = 0;
        
        const checkPattern = (address) => {
            const addr = caseSensitive ? address : address.toLowerCase();
            const pat = caseSensitive ? pattern : pattern.toLowerCase();
            
            switch (position) {
                case 'start': return addr.startsWith(pat);
                case 'end': return addr.endsWith(pat);
                case 'anywhere': return addr.includes(pat);
                default: return addr.endsWith(pat);
            }
        };
        
        const workers = [];
        const workerCount = require('os').cpus().length;
        
        return new Promise((resolve, reject) => {
            const checkTimeout = setInterval(() => {
                if (Date.now() - startTime > timeout) {
                    clearInterval(checkTimeout);
                    reject(new Error(`Timeout after ${attempts} attempts`));
                }
            }, 1000);
            
            for (let i = 0; i < workerCount; i++) {
                const worker = setInterval(() => {
                    for (let j = 0; j < 1000; j++) {
                        attempts++;
                        const keypair = Keypair.generate();
                        const address = keypair.publicKey.toString();
                        
                        if (checkPattern(address)) {
                            workers.forEach(w => clearInterval(w));
                            clearInterval(checkTimeout);
                            
                            const result = {
                                keypair,
                                address,
                                attempts,
                                duration: Date.now() - startTime
                            };
                            
                            resolve(result);
                            return;
                        }
                    }
                }, 0);
                
                workers.push(worker);
            }
        });
    }

    saveWalletState() {
        fs.writeFileSync(this.walletFile, JSON.stringify(this.wallets, null, 2));
        
        if (!fs.existsSync(path.dirname(this.mainWalletFile))) {
            fs.mkdirSync(path.dirname(this.mainWalletFile), { recursive: true });
        }
        
        if (this.mainWallet) {
            fs.writeFileSync(
                this.mainWalletFile,
                JSON.stringify(Array.from(this.mainWallet.secretKey))
            );
        }
    }

    async loadMainWallet() {
        try {
            const data = JSON.parse(fs.readFileSync(this.mainWalletFile, 'utf8'));
            return Keypair.fromSecretKey(new Uint8Array(data));
        } catch {
            return null;
        }
    }
}

module.exports = { WalletManager }; 
