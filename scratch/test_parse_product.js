const assert = require('assert');

// Copy the parseProduct function from dashboard.js
function parseProduct(productName) {
  if (!productName) {
    return { name: "Noma'lum", qty: 1 };
  }
  
  // Extract quantity if present at the end (e.g. "2ta", "3 ta", "5 dona", "2 шт")
  const match = productName.match(/(\d+)\s*(?:ta|dona|sht|pcs|штук|шт)\s*$/i);
  let qty = 1;
  let baseName = productName;
  if (match) {
    qty = parseInt(match[1], 10);
    baseName = productName.substring(0, productName.lastIndexOf(match[0])).trim();
  }

  // Normalize baseName to match core product definitions
  let normalized = baseName;
  const lower = baseName.toLowerCase();
  
  if (/6-funksiyalik|6-funksiya|6 talik|6-talik|6 lik|6lik|6 ta|olti talik|6-ta|massajor 6|е6/i.test(lower)) {
    normalized = '6-funksiyalik';
  } else if (/3-funksiyalik|3-funkiyalik|3-funksiya|3 talik|3-talik|3 lik|3lik|3 ta|uch talik|3-ta/i.test(lower)) {
    normalized = '3-funksiyalik';
  } else if (/oyoq|nog|stup|tavon/i.test(lower)) {
    normalized = 'Oyoq massajor';
  } else if (/hadiya|hadya|sovg'a|sovga|toplam|to'plam|хадия|хадя|совға|совga/i.test(lower)) {
    normalized = 'Хадия';
  } else {
    // Default fallback to trimmed version of the base name
    normalized = baseName.trim();
  }
  
  return { name: normalized, qty };
}

// Test cases
const tests = [
  { input: "6-funksiyalik 2ta", expected: { name: "6-funksiyalik", qty: 2 } },
  { input: "6-funksiyalik 2 ta", expected: { name: "6-funksiyalik", qty: 2 } },
  { input: "6-funksiyalik 3 dona", expected: { name: "6-funksiyalik", qty: 3 } },
  { input: "3-funksiyalik", expected: { name: "3-funksiyalik", qty: 1 } },
  { input: "3-funksiyalik 5 ta", expected: { name: "3-funksiyalik", qty: 5 } },
  { input: "Хадия", expected: { name: "Хадия", qty: 1 } },
  { input: "hadiya 1ta", expected: { name: "Хадия", qty: 1 } },
  { input: "sovg'a 2 ta", expected: { name: "Хадия", qty: 2 } },
  { input: "Oyoq massajor 1 ta", expected: { name: "Oyoq massajor", qty: 1 } },
  { input: "Tavon massajor 3 dona", expected: { name: "Oyoq massajor", qty: 3 } },
  { input: "Random Product", expected: { name: "Random Product", qty: 1 } },
  { input: "Random Product 4 ta", expected: { name: "Random Product", qty: 4 } },
];

let failed = false;
for (const t of tests) {
  const result = parseProduct(t.input);
  try {
    assert.strictEqual(result.name, t.expected.name, `For input "${t.input}", expected name "${t.expected.name}" but got "${result.name}"`);
    assert.strictEqual(result.qty, t.expected.qty, `For input "${t.input}", expected qty ${t.expected.qty} but got ${result.qty}`);
    console.log(`✓ Passed: "${t.input}" -> { name: "${result.name}", qty: ${result.qty} }`);
  } catch (err) {
    console.error(`✗ Failed: "${t.input}" ->`, err.message);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log("\nAll unit tests passed successfully!");
}
