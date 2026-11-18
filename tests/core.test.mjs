// Tests for src/core.js: RFC 4226/6238 vectors, Base32, otpauth:// and
// Google Authenticator otpauth-migration:// parsing. Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const core = await import(new URL('../authenticator-extension/src/core.js', import.meta.url));
const ascii = (s) => core.base32Encode(new TextEncoder().encode(s));

test('HOTP matches RFC 4226 appendix D', async () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  for (let i = 0; i < want.length; i++) {
    assert.equal(await core.hotp(ascii('12345678901234567890'), i), want[i], `counter ${i}`);
  }
});

test('TOTP matches RFC 6238 appendix B (SHA1/SHA256/SHA512, 8 digits)', async () => {
  const seeds = {
    SHA1: '12345678901234567890',
    SHA256: '12345678901234567890123456789012',
    SHA512: '1234567890123456789012345678901234567890123456789012345678901234',
  };
  const vectors = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [t, s1, s256, s512] of vectors) {
    for (const [alg, want] of [['SHA1', s1], ['SHA256', s256], ['SHA512', s512]]) {
      const acc = core.makeAccount({ secret: ascii(seeds[alg]), name: 'x', algorithm: alg, digits: 8 });
      assert.equal(await core.generateCode(acc, t * 1000), want, `${alg} @ ${t}`);
    }
  }
});

test('Base32 tolerates spaces, lowercase and padding', () => {
  assert.equal(core.base32Encode(core.base32Decode('jbsw y3dp ehpk 3pxp====')), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => core.base32Decode('ABC1'), /"1"/);
});

test('formatCode groups digits', () => {
  assert.deepEqual([core.formatCode('123456'), core.formatCode('12345678')], ['123 456', '1234 5678']);
});

test('otpauth:// URIs', () => {
  const a = core.parseOtpauthUri('otpauth://totp/GitHub:me%40mail.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&period=30');
  assert.deepEqual([a.issuer, a.name, a.secret, a.digits, a.algorithm], ['GitHub', 'me@mail.com', 'JBSWY3DPEHPK3PXP', 6, 'SHA1']);
  const b = core.parseOtpauthUri('otpauth://totp/Example:alice?secret=jbswy3dpehpk3pxp&algorithm=SHA256&digits=8');
  assert.deepEqual([b.issuer, b.name, b.algorithm, b.digits], ['Example', 'alice', 'SHA256', 8]);
});

// --- Minimal protobuf encoder to build fake Google Authenticator export payloads ---
const varint = (n) => {
  n = BigInt.asUintN(64, BigInt(n));
  const out = [];
  do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
};
const field = (no, wireType, payload) => [...varint((no << 3) | wireType), ...payload];
const lenField = (no, bytes) => field(no, 2, [...varint(bytes.length), ...bytes]);
const str = (s) => [...new TextEncoder().encode(s)];
const sec = (s) => new TextEncoder().encode(s);
function otpParams({ secret, name, issuer, alg = 1, digits = 1, type = 2, counter = 0 }) {
  return [
    ...lenField(1, [...secret]), ...lenField(2, str(name)), ...(issuer ? lenField(3, str(issuer)) : []),
    ...field(4, 0, varint(alg)), ...field(5, 0, varint(digits)), ...field(6, 0, varint(type)), ...field(7, 0, varint(counter)),
  ];
}
function migrationUri(list, batch) {
  const bytes = [
    ...list.flatMap((p) => lenField(1, otpParams(p))), ...field(2, 0, varint(1)),
    ...field(3, 0, varint(batch.size)), ...field(4, 0, varint(batch.index)), ...field(5, 0, varint(batch.id)),
  ];
  return 'otpauth-migration://offline?data=' + encodeURIComponent(Buffer.from(bytes).toString('base64'));
}

const sample = [
  { secret: sec('12345678901234567890'), name: 'alice@example.com', issuer: 'Google' },
  { secret: sec('abcdefghij'), name: 'GitHub:alice', issuer: '' },
  { secret: sec('12345678901234567890123456789012'), name: 'alice', issuer: 'Exchange', alg: 2, digits: 2 },
  { secret: sec('qwertyuiopasdfghjkl'), name: 'Bank Ünïcödé ✓', issuer: 'Bank' },
  { secret: sec('hotp-secret-123'), name: 'yubi', issuer: 'HOTP Svc', type: 1, counter: 7 },
  { secret: sec('md5secret!'), name: 'old', issuer: 'Legacy', alg: 4 }, // MD5 is unsupported -> skipped
];
const uri = migrationUri(sample, { size: 2, index: 0, id: -123456 });

test('otpauth-migration:// export is parsed', async () => {
  const mig = core.parseMigrationUri(uri);
  assert.deepEqual([mig.accounts.length, mig.skipped.length], [5, 1]);
  assert.deepEqual([mig.batchSize, mig.batchIndex, mig.batchId], [2, 0, -123456]);
  assert.deepEqual(mig.accounts.map((x) => [x.issuer, x.name]), [
    ['Google', 'alice@example.com'], ['GitHub', 'alice'], ['Exchange', 'alice'], ['Bank', 'Bank Ünïcödé ✓'], ['HOTP Svc', 'yubi'],
  ]);
  assert.deepEqual(
    [mig.accounts[2].algorithm, mig.accounts[2].digits, mig.accounts[4].type, mig.accounts[4].counter],
    ['SHA256', 8, 'hotp', 7],
  );
  assert.equal(await core.generateCode(mig.accounts[0], 59000), '287082'); // 6-digit tail of RFC 94287082
});

test('migration data survives "+" turned into spaces', () => {
  const mangled = 'otpauth-migration://offline?data=' + decodeURIComponent(uri.split('data=')[1]).replace(/\+/g, ' ');
  assert.equal(core.parseMigrationUri(mangled).accounts.length, 5);
});

test('parseAnyText handles mixed input', () => {
  const any = core.parseAnyText(`${uri}\n otpauth://totp/X:y?secret=JBSWY3DPEHPK3PXP  garbage`);
  assert.deepEqual([any.accounts.length, any.batches.length, any.errors.length], [6, 1, 1]);
});
