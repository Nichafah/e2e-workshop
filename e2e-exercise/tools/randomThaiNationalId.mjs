import { fileURLToPath } from 'node:url';

// Generate once and paste into a test; do not randomize during test execution.
export function randomThaiNationalId() {
  const first12 = '9' + Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
  const sum = [...first12].reduce((acc, digit, i) => acc + Number(digit) * (13 - i), 0);
  return first12 + ((11 - (sum % 11)) % 10);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(randomThaiNationalId());
