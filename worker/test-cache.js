#!/usr/bin/env node

/**
 * Simple test script to verify caching is working
 * Run this after starting the worker with: npm run dev
 */

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const TEST_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL'];

async function testCache() {
  console.log('🧪 Testing cache implementation...\n');
  console.log(`Worker URL: ${WORKER_URL}\n`);

  const testUrl = `${WORKER_URL}/api/stocks?symbols=${TEST_SYMBOLS.join(',')}&includeHistory=true`;

  console.log('📊 Test 1: First request (should be Cache MISS)');
  const start1 = Date.now();
  const response1 = await fetch(testUrl);
  const time1 = Date.now() - start1;
  const data1 = await response1.json();
  console.log(`   Status: ${response1.status}`);
  console.log(`   Time: ${time1}ms`);
  console.log(`   Stocks returned: ${data1.data?.length || 0}`);
  console.log(`   Cache-Control: ${response1.headers.get('Cache-Control') || 'none'}\n`);

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log('📊 Test 2: Second request (should be Cache HIT)');
  const start2 = Date.now();
  const response2 = await fetch(testUrl);
  const time2 = Date.now() - start2;
  const data2 = await response2.json();
  console.log(`   Status: ${response2.status}`);
  console.log(`   Time: ${time2}ms`);
  console.log(`   Stocks returned: ${data2.data?.length || 0}`);
  console.log(`   Cache-Control: ${response2.headers.get('Cache-Control') || 'none'}\n`);

  if (time2 < time1 * 0.5) {
    console.log('✅ Cache appears to be working! (Second request was significantly faster)');
  } else {
    console.log('⚠️  Cache might not be working (second request was not faster)');
    console.log('   Check worker logs for cache HIT/MISS messages');
  }

  console.log('\n📊 Test 3: Wait 35 seconds and request again (cache should expire)');
  console.log('   (Skipping - you can test this manually)');
  console.log('   After 35 seconds, the cache should expire and you\'ll see a Cache MISS again\n');
}

testCache().catch(err => {
  console.error('❌ Test failed:', err.message);
  console.error('\nMake sure the worker is running:');
  console.error('  cd worker && npm run dev');
  process.exit(1);
});

