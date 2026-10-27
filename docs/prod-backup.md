# Backup completo PROD

O workflow `backup-prod.yml` executa diariamente às 03:00 UTC e também por dispatch em master. Usa Environment `backup-prod`, identidade exclusiva `github-backup-prod` e WIF restrito ao workflow. Não exige secrets permanentes.

O snapshot usa um único readTime para todas as coleções, inclui descendentes de documentos pais ausentes e preserva os tipos REST Firestore. É armazenado somente em `bem-feito-archive-prod`, no formato create-only de FirestoreArchive: manifesto `archive-backups/<sha256>` e partes de 400 KB com checksums. Todos os chunks são relidos e o digest completo é comparado. Os logs contêm somente contagem, horário e hash.

A retenção é indefinida, sem exclusão automática. Há limites explícitos de 10.000 documentos e 6 MB por snapshot. Ao ultrapassá-los o job falha, sem registrar backup parcial. Monitorar falhas dos Actions e crescimento do arquivo; cotas gratuitas e espaço são finitos. Este workflow não copia imagens nem concessões do D1; as imagens permanecem no Drive privado PROD e o D1 tem recuperação própria por Time Travel.

Para recuperação: selecionar hash e horário, ler com `readSnapshot`, verificar todos os checksums e restaurar primeiro em banco isolado vazio. Cada documento é reconstruído com seu `fields` REST original e nome de destino ajustado, usando `currentDocument.exists=false`. Comparar integralmente os paths e campos antes de qualquer recuperação real. Uma recuperação de PROD exige aprovação específica e novo snapshot do estado atual; não sobrescrever dados nem excluir documentos automaticamente. O teste de emulador exercita leitura do arquivo e restauração em projeto independente, inclusive tipos, precisão e subcoleções sem pai.

O teste em emulador comprova o caminho de serialização/restore, mas não substitui um exercício operacional de desastre, a verificação do acesso IAM real, nem os primeiros snapshots pelo workflow OIDC. O snapshot inicial DEV de migração tem `kind=initial-prod-migration-source` e registra a origem; não deve ser restaurado indiscriminadamente sobre PROD.
