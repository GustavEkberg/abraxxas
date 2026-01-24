const MANIFEST_BRANCH_PREFIX = 'prd-'

/** Derive branch name from prdName */
export const getManifestBranchName = (prdName: string) => `${MANIFEST_BRANCH_PREFIX}${prdName}`
