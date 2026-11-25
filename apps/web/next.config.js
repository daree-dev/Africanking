/** @type {import('next').NextConfig} */

// Explicit inventory of required third-party origins.
// Keep this list tight — no broad wildcards. Documented in docs/SECURITY_HEADERS.md.
const WALLET_SCRIPT_SRC = [
  'https://*.walletconnect.com',
  'https://*.walletconnect.org',
  'https://*.coinbase.com',
];
const WALLET_CONNECT_SRC = [
  'https://*.walletconnect.com',
  'https://*.walletconnect.org',
  'wss://*.walletconnect.com',
  'wss://*.walletconnect.org',
  'https://*.coinbase.com',
  'wss://*.coinbase.com',
];
const ANALYTICS_SCRIPT_SRC = ['https://www.googletagmanager.com'];
const ANALYTICS_CONNECT_SRC = [
  'https://www.google-analytics.com',
  'https://region1.google-analytics.com',
];
const ANALYTICS_IMG_SRC = [
  'https://www.google-analytics.com',
  'https://www.googletagmanager.com',
];

const isProd = process.env.NODE_ENV === 'production';

function buildCsp() {
  const scriptSrc = [
    "'self'",
    // Next.js injects inline bootstrap scripts; nonce/hash wiring is out of scope here.
    "'unsafe-inline'",
    ...WALLET_SCRIPT_SRC,
    ...ANALYTICS_SCRIPT_SRC,
  ];
  const connectSrc = [
    "'self'",
    ...WALLET_CONNECT_SRC,
    ...ANALYTICS_CONNECT_SRC,
  ];
  const imgSrc = ["'self'", 'data:', 'blob:', ...ANALYTICS_IMG_SRC];
  const frameSrc = ["'self'", ...WALLET_SCRIPT_SRC];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    `frame-src ${frameSrc.join(' ')}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  if (isProd) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: buildCsp() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

if (isProd) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  });
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
