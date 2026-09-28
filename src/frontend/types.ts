export interface FrontendProp { name: string; required: boolean; type: string; values?: Array<string | number | boolean>; }
export interface FrontendComponent {
  path: string; exportName: string; import: string; sourceHash: string;
  props: FrontendProp[]; propsComplete: boolean; line: number;
}
export interface FrontendToken { path: string; name: string; value: string | number; mode: string; }
export interface FrontendStory { path: string; exportName: string; ref: string; componentPath: string; componentExport: string; id?: string; status: 'inferred'; }
export interface FrontendOmission { path: string; reason: string; }
export interface FrontendMapping {
  path: string; exportName: string; status: 'observed' | 'stale' | 'conflict' | 'unassessed';
  issues: string[]; storyRefs: string[]; mustReuse: boolean;
  requestedProps: Record<string, string | number | boolean | null>; tokenRefs: string[];
}
export interface FrontendVerificationReceipt {
  kind: 'typecheck' | 'storybook' | 'browser' | 'accessibility';
  outcome: 'passed' | 'failed' | 'skipped';
  runId: string; observedAt: string; storyRef?: string; artifactPath?: string;
  acquisition: 'host-supplied'; association: 'current-scan' | 'stale-scan' | 'unmatched-story';
  scope: 'bounded-frontend-sources';
}
export interface FrontendBrief {
  schemaVersion: 'memi.frontend-brief.v1'; intent: string;
  design: { source: 'figma' | 'paper'; documentId?: string; nodeId?: string; revision?: string; fingerprint: string; acquisition: 'host-supplied'; adapterVersion: '1'; } | null;
  components: FrontendComponent[]; tokens: FrontendToken[]; stories: FrontendStory[]; mappings: FrontendMapping[];
  scan: { complete: boolean; filesRead: number; bytesRead: number; fingerprint: string; };
  omissions: FrontendOmission[]; retrieval: string[]; unresolved: string[];
  verification: { status: 'unassessed'; checkoutIdentity: 'unassessed'; reason: string; receipts: FrontendVerificationReceipt[]; };
  limits: { maxBytes: number; maxFiles: number; maxBytesPerFile: number; maxTotalBytes: number; omittedItems: number; };
}
