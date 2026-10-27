import type {Run} from '@oddhound/contracts';
export function ApprovedScope({scope}:{scope:NonNullable<Run['approvedScope']>}){
  const {grant}=scope;
  return <details className="provenance"><summary>Approved run scope</summary>
    <p>{grant.mode==='isolated_staging'?'Isolated staging with synthetic accounts and data.':'Writes limited to the approved operation policy.'}</p>
    <h3>Active origins</h3><ul>{scope.activeOrigins.map(s=><li key={s.origin}><code>{s.origin}</code> · revision {s.revision}</li>)}</ul>
    <h3>Actors and credential references</h3><ul>{grant.actors.map(a=><li key={a.id}>{a.label}: {a.credentialReferences.length?a.credentialReferences.join(', '):'generated identity references only'}</li>)}</ul>
    <h3>Synthetic data</h3><p>Namespace: <code>{grant.data.namespace}</code></p><p>{grant.data.fixtureIds.length?`Bound record IDs: ${grant.data.fixtureIds.join(', ')}`:'No pre-existing record IDs granted.'}</p>
    <p>HTTP methods: {grant.uiMethods.join(', ')}. Up to {grant.registration?.maxAccounts??0} prepared registration identities.</p>
    <h3>Cleanup</h3><p>{grant.data.cleanupInstructions}</p>
    {grant.deniedPaths.length>0&&<><h3>Denied paths</h3><p>{grant.deniedPaths.join(', ')}</p></>}
    {grant.resourceOrigins.length>0&&<><h3>Resource origins</h3><p>{grant.resourceOrigins.join(', ')}</p></>}
    <p>The saved contract stays unchanged. New permissions require a new run.</p><code>{scope.hash}</code>
  </details>;
}
