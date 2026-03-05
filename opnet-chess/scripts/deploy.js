#!/usr/bin/env node
/**
 * deploy.js — OP_NET Chess Contract Deployment Script
 *
 * Usage:
 *   node scripts/deploy.js --network testnet
 *   node scripts/deploy.js --network mainnet
 *
 * Prerequisites:
 *   1. Build the contract: npm run build:contract
 *   2. Set DEPLOYER_WIF in environment (WIF private key for funding)
 *      OR use a wallet signer
 *
 * The script:
 *   1. Reads the compiled WASM from contract/build/chess.wasm
 *   2. Connects to the OP_NET RPC endpoint
 *   3. Builds and broadcasts the deployment inscription transaction
 *   4. Polls for confirmation and extracts the contract address (op1...)
 *   5. Updates frontend/src/lib/opnet.ts with the deployed address
 *   6. Outputs a deployment receipt to scripts/deployed.json
 */

import fs   from 'fs';
import path from 'path';
import https from 'https';

// ─── Config ────────────────────────────────────────────────────────────────────

const NETWORKS = {
  testnet: {
    rpcUrl:  'https://testnet.opnet.org',
    name:    'OP_NET Testnet',
    feeRate: 10,  // sat/vbyte — lower for testnet
  },
  mainnet: {
    rpcUrl:  'https://api.opnet.org',
    name:    'Bitcoin Mainnet (OP_NET)',
    feeRate: 20,  // sat/vbyte — check mempool before deploying
  },
};

// ─── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const networkArg = args[args.indexOf('--network') + 1] ?? 'testnet';

if (!NETWORKS[networkArg]) {
  console.error(`❌ Unknown network: ${networkArg}. Use --network testnet|mainnet`);
  process.exit(1);
}

const network = NETWORKS[networkArg];
console.log(`\n🚀 Deploying OP_NET Chess contract to ${network.name}...\n`);

// ─── Load WASM ─────────────────────────────────────────────────────────────────

const wasmPath = path.resolve('./contract/build/chess.wasm');
if (!fs.existsSync(wasmPath)) {
  console.error(`❌ WASM not found at ${wasmPath}`);
  console.error('   Run: npm run build:contract first');
  process.exit(1);
}

const wasmBytes = fs.readFileSync(wasmPath);
const wasmHex   = wasmBytes.toString('hex');
const wasmSize  = wasmBytes.length;

console.log(`📦 Contract size: ${wasmSize} bytes (${(wasmSize/1024).toFixed(2)} KB)`);

if (wasmSize > 400_000) {
  console.warn(`⚠️  Contract is ${(wasmSize/1024).toFixed(1)} KB — OP_NET maximum is ~400 KB`);
}

// ─── RPC helper ────────────────────────────────────────────────────────────────

async function rpc(url, method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    });
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.result);
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main deployment flow ──────────────────────────────────────────────────────

async function deploy() {
  // 1. Check RPC connection
  console.log(`🔌 Connecting to ${network.rpcUrl}...`);
  try {
    const info = await rpc(network.rpcUrl, 'getBlockchainInfo', []);
    console.log(`✅ Connected — block height: ${info?.blocks ?? 'unknown'}\n`);
  } catch (e) {
    console.error(`❌ RPC connection failed: ${e.message}`);
    console.error(`   Ensure the OP_NET node is reachable at ${network.rpcUrl}`);
    process.exit(1);
  }

  // 2. Build deployment payload
  //    OP_NET contracts are deployed by broadcasting a special inscription
  //    that contains the WASM bytecode.
  const deployPayload = {
    bytecode: wasmHex,
    feeRate:  network.feeRate,
    // Optional: initial calldata for onDeployment()
    calldata: '',
  };

  console.log(`📡 Broadcasting deployment transaction...`);
  console.log(`   Fee rate: ${network.feeRate} sat/vbyte`);

  let txid, contractAddress;

  try {
    const result = await rpc(network.rpcUrl, 'deployContract', [deployPayload]);
    txid            = result?.txid;
    contractAddress = result?.contractAddress;

    if (!txid) {
      throw new Error('No txid returned from deployment');
    }
  } catch (e) {
    // Simulate for testing if RPC doesn't support direct deploy
    console.log(`\n⚠️  Live deployment requires a funded wallet and signed transaction.`);
    console.log(`   For testnet faucet: https://testnet.opnet.org/faucet`);
    console.log(`\n📋 Manual deployment steps:`);
    console.log(`   1. Install OP_NET CLI:  npm i -g @btc-vision/opnet-cli`);
    console.log(`   2. Fund your wallet from testnet faucet`);
    console.log(`   3. Run: opnet-cli deploy --wasm contract/build/chess.wasm --network ${networkArg}`);
    console.log(`   4. Copy the contract address (op1...) into:`);
    console.log(`      frontend/src/lib/opnet.ts → CONTRACT_ADDRESSES.${networkArg}`);
    console.log(`\n💡 Alternatively, use the Wizz or UniSat wallet deploy flow.`);

    // Write a placeholder receipt
    const receipt = {
      network:   networkArg,
      status:    'pending_manual',
      wasmPath,
      wasmSize,
      deployedAt: new Date().toISOString(),
      note: 'Manual deployment required — see console output above',
    };
    fs.writeFileSync('./scripts/deployed.json', JSON.stringify(receipt, null, 2));
    console.log(`\n📄 Placeholder receipt saved to scripts/deployed.json`);
    return;
  }

  // 3. Poll for confirmation (up to 30 minutes = ~3 Bitcoin blocks)
  console.log(`\n⏳ Waiting for confirmation (txid: ${txid})...`);
  let confirmed = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 30_000)); // 30s intervals
    try {
      const status = await rpc(network.rpcUrl, 'getContractStatus', [contractAddress]);
      if (status?.confirmed) { confirmed = true; break; }
      process.stdout.write(`.`);
    } catch { /* keep polling */ }
  }
  if (!confirmed) {
    console.log(`\n⚠️  Transaction not yet confirmed. Check txid: ${txid}`);
    console.log(`   Contract address: ${contractAddress}`);
  }

  // 4. Update frontend config
  const opnetLibPath = './frontend/src/lib/opnet.ts';
  if (fs.existsSync(opnetLibPath)) {
    let content = fs.readFileSync(opnetLibPath, 'utf8');
    const key = `REPLACE_AFTER_DEPLOY_${networkArg.toUpperCase()}`;
    if (content.includes(key)) {
      content = content.replace(key, contractAddress);
      fs.writeFileSync(opnetLibPath, content);
      console.log(`\n✅ Updated ${opnetLibPath} with contract address`);
    }
  }

  // 5. Save receipt
  const receipt = {
    network:         networkArg,
    contractAddress,
    txid,
    confirmed,
    wasmSize,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync('./scripts/deployed.json', JSON.stringify(receipt, null, 2));

  console.log(`\n🎉 Deployment complete!`);
  console.log(`   Contract address: ${contractAddress}`);
  console.log(`   Transaction ID:   ${txid}`);
  console.log(`   Receipt saved to: scripts/deployed.json`);
  console.log(`\n🌐 View on explorer:`);
  console.log(`   https://${networkArg === 'mainnet' ? '' : 'testnet.'}opnet.org/contract/${contractAddress}`);
}

deploy().catch(e => {
  console.error('\n❌ Deployment failed:', e.message);
  process.exit(1);
});
