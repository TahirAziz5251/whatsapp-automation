# Called after the encrypted pre-migration backup. Scope only Phase 4 role names.
$hba=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' 'SHOW hba_file') 'HBA path check'
if($hba -ne '/var/lib/postgresql/data/pg_hba.conf'){throw 'Unexpected dev HBA location; refusing to edit'}
$roles=($Phase4Databases|ForEach-Object {$p=$_.Replace('_db','');"${p}_runtime,${p}_migrator,${p}_owner"}) -join ','
$block="# BEGIN PHASE4 MANAGED ROLES`nlocal all $roles scram-sha-256`nhost all $roles all scram-sha-256`n# END PHASE4 MANAGED ROLES`n"
$shell=@'
set -eu
target=/var/lib/postgresql/data/pg_hba.conf
test -f "$target"
if [ ! -f /var/lib/postgresql/data/pg_hba.conf.before-phase4 ]; then cp -p "$target" /var/lib/postgresql/data/pg_hba.conf.before-phase4; fi
tmp=$(mktemp /var/lib/postgresql/data/phase4-hba.XXXXXX)
cat > "$tmp"
awk '/^# BEGIN PHASE4 MANAGED ROLES$/{skip=1;next} /^# END PHASE4 MANAGED ROLES$/{skip=0;next} !skip{print}' "$target" >> "$tmp"
chown postgres:postgres "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$target"
'@
$result=Invoke-Phase4Docker -Arguments @('exec','-i',$Phase4Container,'sh','-c',$shell) -InputText $block
if($result.code){throw 'Dev scoped HBA configuration failed'}
$errors=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' 'SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL') 'HBA validation'
if($errors -ne '0'){throw 'Invalid HBA rules; do not proceed'}
$null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' 'SELECT pg_reload_conf()') 'Reload scoped authentication rules'
Write-Output 'Phase 4 runtime/migrator roles require SCRAM on local socket and TCP; bootstrap admin authentication unchanged.'
