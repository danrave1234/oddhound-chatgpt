import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Oddhound — Find what you didn’t test.',description:'Active exploratory testing for websites you own. Follow the evidence from failure to fix.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
