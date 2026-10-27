import type { NextConfig } from 'next';
const config:NextConfig={output:'standalone',allowedDevOrigins:['127.0.0.1','localhost'],distDir:process.env.NEXT_DIST_DIR??'.next',devIndicators:false,transpilePackages:['@oddhound/contracts','@oddhound/db','@oddhound/agent','@oddhound/ui'],serverExternalPackages:['pg','bullmq'],poweredByHeader:false,async headers(){return[{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'X-Frame-Options',value:'DENY'}]}]}};
export default config;
