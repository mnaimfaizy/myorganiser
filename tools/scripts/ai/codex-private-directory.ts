import { spawnSync } from 'node:child_process';

// Windows ignores POSIX mode bits. Protect the directory before writing any
// context and verify that its only access rule belongs to the current user.
export function protectDirectory(directory: string) {
  if (process.platform !== 'win32')
    throw new Error('Private directory protection requires Windows');
  const script = String.raw`$ErrorActionPreference = 'Stop'
$Path = $env:MYORGANISER_CONTEXT_DIRECTORY
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$directory = [System.IO.DirectoryInfo]::new($Path)
$acl = $directory.GetAccessControl()
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
$acl.SetOwner($identity)
$directory.SetAccessControl($acl)
$actual = $directory.GetAccessControl()
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (-not $actual.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $identity.Value -or $rules[0].AccessControlType -ne 'Allow' -or ($rules[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $rules[0].IsInherited) { throw 'Private directory ACL verification failed' }`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: { ...process.env, MYORGANISER_CONTEXT_DIRECTORY: directory },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8192,
    },
  );
  if (result.status !== 0 || result.error)
    throw new Error(
      `Cannot protect the temporary context directory. The restricted launcher does not run inside a Codex sandbox; run it from a Windows terminal outside Codex. ${result.stderr?.trim() || result.error?.message || 'unknown error'}`,
    );
}
