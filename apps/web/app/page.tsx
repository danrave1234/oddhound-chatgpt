import {workspace} from '../lib/store';
import {WorkspaceApp} from './workspace';
export const dynamic='force-dynamic';
export default async function Page(){return <WorkspaceApp initial={await workspace()}/>;}
