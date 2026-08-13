# JAGO Staging Isolation Checklist

Production and staging must never share mutable runtime state.

## Infrastructure Separation

- [ ] Separate PostgreSQL database
- [ ] Separate Redis instance
- [ ] Separate socket namespace / cluster
- [ ] Separate backend environment variables
- [ ] Separate Maps / Places keys
- [ ] Separate Firebase project / config files
- [ ] Separate push notification credentials

## Runtime Governance

- [ ] Staging runtime config writes only affect staging
- [ ] Staging audit logs separated from production
- [ ] Rollback in staging cannot touch production state
- [ ] Socket broadcasts in staging cannot reach production clients

## Mobile

- [ ] Staging customer app base URL isolated
- [ ] Staging driver app base URL isolated
- [ ] Staging build flavor or env flag documented

## Operations

- [ ] Staging monitoring separated
- [ ] Staging alerts separated
- [ ] Staging admin access scoped
