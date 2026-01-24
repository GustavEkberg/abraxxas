const MANIFEST_BRANCH_PREFIX = 'manifest-'

/** Derive branch name from prdName */
export const getManifestBranchName = (prdName: string) => `${MANIFEST_BRANCH_PREFIX}${prdName}`
