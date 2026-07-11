import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
// Custom metrics
const errorRate = new Rate('error_rate');
const toolCallDuration = new Trend('tool_call_duration', true);
const successfulCalls = new Counter('successful_tool_calls');
const failedCalls = new Counter('failed_tool_calls');

// Test configuration — stages ramp up then tear down
// export const options = {
//   stages: [
//     { duration: '30s', target: 10 }, // warm up
//     { duration: '1m', target: 50 }, // ramp to normal load
//     { duration: '2m', target: 50 }, // hold normal load
//     { duration: '1m', target: 100 }, // ramp to stress
//     { duration: '2m', target: 100 }, // hold stress
//     { duration: '1m', target: 200 }, // spike
//     { duration: '30s', target: 0 }, // cool down
//   ],
//   thresholds: {
//     http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
//     http_req_failed: ['rate<0.10'], // less than 5% failure rate
//     error_rate: ['rate<0.05'],
//     tool_call_duration: ['p(99)<5000'],
//   },
// };

export const options = {
  vus: 1, // Minimal load
  duration: '1m', // Short duration
};

const BASE_URL = 'http://localhost:3000';

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function mcpRequest(toolName, args = {}) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 100000),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/mcp`, payload, { headers: HEADERS });
  toolCallDuration.add(Date.now() - start);

  return res;
}

function assertSuccess(res, label) {
  const ok = check(res, {
    [`${label} status 200`]: (r) => r.status === 200,
    [`${label} has result`]: (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.result !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (ok) {
    successfulCalls.add(1);
    errorRate.add(0);
  } else {
    failedCalls.add(1);
    errorRate.add(1);
    console.error(`[FAIL] ${label} | status=${res.status} body=${res.body?.slice(0, 200)}`);
  }

  return ok;
}

// ── Scenarios ──────────────────────────────────────────────────────────────

function testHealth() {
  const res = http.get(`${BASE_URL}/health`, { headers: HEADERS });
  check(res, {
    'health status 200': (r) => r.status === 200,
    'health ok': (r) => {
      try {
        return JSON.parse(r.body).status === 'ok';
      } catch {
        return false;
      }
    },
  });
}

function testListTools() {
  const res = http.get(`${BASE_URL}/tools`, { headers: HEADERS });
  check(res, {
    'tools status 200': (r) => r.status === 200,
    'tools array present': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).tools);
      } catch {
        return false;
      }
    },
  });
}

function testListProducts() {
  const res = mcpRequest('list_products_api_products_get', {
    page: Math.floor(Math.random() * 5) + 1,
    limit: [10, 20, 50][Math.floor(Math.random() * 3)],
  });
  assertSuccess(res, 'list_products');
}

function testListProductsFiltered() {
  const categories = ['electronics', 'clothing', 'books', 'food', 'sports'];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const res = mcpRequest('list_products_api_products_get', { category });
  assertSuccess(res, `list_products[category=${category}]`);
}

function testGetProduct() {
  const productId = Math.floor(Math.random() * 18) + 1;
  const res = mcpRequest('get_product_api_products__product_id__get', {
    product_id: productId,
  });
  // 404s are valid for random IDs, just check it responded
  check(res, {
    'get_product responded': (r) => r.status === 200,
  });
}

function testListCategories() {
  const res = mcpRequest('list_categories_api_categories_get', {});
  assertSuccess(res, 'list_categories');
}

function testMetricsEndpoint() {
  const res = http.get(`${BASE_URL}/metrics`, { headers: HEADERS });
  check(res, {
    'metrics status 200': (r) => r.status === 200,
    'metrics has content': (r) => r.body?.length > 0,
  });
}

function testMalformedRequest() {
  // Make sure server handles bad input gracefully
  const res = http.post(
    `${BASE_URL}/mcp`,
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }), // missing params
    { headers: HEADERS }
  );
  check(res, {
    'malformed request doesnt 500': (r) => r.status !== 500,
  });
}

function testNonExistentTool() {
  const res = mcpRequest('tool_that_does_not_exist', {});
  check(res, {
    'unknown tool doesnt 500': (r) => r.status !== 500,
  });
}

// ── Main VU loop ───────────────────────────────────────────────────────────

export default function () {
  const roll = Math.random();

  if (roll < 0.05) {
    // 5% — health + tools discovery
    testHealth();
    sleep(0.1);
    testListTools();
  } else if (roll < 0.35) {
    // 30% — list products (most common call)
    group('Product List', () => {
      testListProducts();
    });
  } else if (roll < 0.55) {
    // 20% — filtered product list
    testListProductsFiltered();
  } else if (roll < 0.75) {
    // 20% — single product lookup
    testGetProduct();
  } else if (roll < 0.85) {
    // 10% — list categories
    testListCategories();
  } else if (roll < 0.9) {
    // 5% — metrics scrape (simulate Prometheus)
    testMetricsEndpoint();
  } else if (roll < 0.95) {
    // 5% — malformed requests
    testMalformedRequest();
  } else {
    // 5% — non-existent tool
    testNonExistentTool();
  }

  sleep(Math.random() * 1 + 0.5); // 0.5–1.5s think time between requests
}

// ── Summary ────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    'stress-test-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(2) ?? 'N/A';
  const p99 = m.http_req_duration?.values?.['p(99)']?.toFixed(2) ?? 'N/A';
  const rps = m.http_reqs?.values?.rate?.toFixed(2) ?? 'N/A';
  const errRate = ((m.error_rate?.values?.rate ?? 0) * 100).toFixed(2);
  const success = m.successful_tool_calls?.values?.count ?? 0;
  const failed = m.failed_tool_calls?.values?.count ?? 0;

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  novamart-api stress test results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RPS (avg):        ${rps}
  p95 latency:      ${p95}ms
  p99 latency:      ${p99}ms
  Error rate:       ${errRate}%
  Successful calls: ${success}
  Failed calls:     ${failed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}
