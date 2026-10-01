$ErrorActionPreference='Stop'
$Phase4Root=Split-Path $PSScriptRoot -Parent
$Phase4Container='business-agent-dev-postgres-1'
$Phase4Databases=@('control_db','pos_db','bise_db','hospital_db')
Add-Type -AssemblyName System.Security
function Invoke-Phase4Docker([string[]]$Arguments,[string]$InputText='') {
 $p=[Diagnostics.Process]::new();$p.StartInfo=[Diagnostics.ProcessStartInfo]::new('docker')
 $p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true
 $p.StartInfo.RedirectStandardInput=$true;$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true
 foreach($a in $Arguments){$p.StartInfo.ArgumentList.Add($a)}
 $null=$p.Start();$stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync()
 $write=$p.StandardInput.WriteAsync($InputText)
 if(!$write.Wait(15000)){$p.Kill($true);$p.WaitForExit();$p.Dispose();return @{code=124;output='';error='Docker stdin timeout; inspect operation state before retry.'}}
 $p.StandardInput.Close()
 if(!$p.WaitForExit(60000)){$p.Kill($true);$p.WaitForExit();$p.Dispose();return @{code=124;output='';error='Docker command timeout; inspect operation state before retry.'}}
 $r=@{code=$p.ExitCode;output=$stdout.Result;error=$stderr.Result};$p.Dispose();return $r
}
function Invoke-Phase4Sql([string]$Database,[string]$Sql,[string]$Role='agent_dev',[string]$Password='') {
 if($Role -eq 'agent_dev'){
  return Invoke-Phase4Docker -Arguments @('exec','-i',$Phase4Container,'psql','-X','-w','-U','agent_dev','-d',$Database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-At') -InputText $Sql
 }
 # Password is stdin only: not a process argument, source file, transcript or tool output.
 $shell='IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -w -h 127.0.0.1 -U "$1" -d "$2" -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -At'
 return Invoke-Phase4Docker -Arguments @('exec','-i',$Phase4Container,'sh','-c',$shell,'phase4',$Role,$Database) -InputText ($Password+"`n"+$Sql)
}
function Assert-Phase4Sql($Result,[string]$Operation){if($Result.code -ne 0){throw "$Operation failed (exit $($Result.code)); SQLSTATE output: $($Result.error)"};return $Result.output.Trim()}
function Get-Phase4Secrets {
 $file=Join-Path $Phase4Root 'development/phase4-secrets.dpapi'
 if(!(Test-Path -LiteralPath $file)){throw 'Run phase4-implement.ps1 to provision encrypted dev credentials first.'}
 $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 return ([Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json -AsHashtable)
}
function Protect-Phase4Text([string]$Path,[string]$Text){
 $bytes=[Text.Encoding]::UTF8.GetBytes($Text)
 [IO.File]::WriteAllBytes($Path,[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
}
