# Canva Submission Checklist - Piwigo Media

Based on Canva's official submission checklist:
https://www.canva.dev/docs/apps/submission-checklist/

## Product

- [x] Core browse flow works: Piwigo albums -> photos.
- [x] Core insert flow works: Piwigo photo -> Canva design.
- [x] Core export flow works: Canva design -> Piwigo album.
- [x] No central Piwigo credential storage.
- [x] Piwigo Connector token flow.
- [ ] Handle multi-page Canva ZIP exports or clearly block them in UI.
- [ ] Add disconnect/reconnect action in the app.
- [ ] Add loading/empty/error polish for all states.

## Localization

- [x] UI strings use `react-intl`.
- [x] English source strings extracted to `plugin/dist/messages_en.json`.
- [x] Upload strings for translation in Canva Developer Portal.
- [ ] Re-run `npm run extract` before submission.

## Marketplace Listing

- [x] App icon / logo uploaded.
- [ ] Featured image uploaded.
- [x] Short description reviewed.
- [x] Long description reviewed.
- [ ] Reviewer notes added.
- [ ] External links removed from listing copy where Canva requires it.

## Security

- [x] Piwigo API keys are not collected by the Canva app or a central backend.
- [x] Connector tokens are generated and revoked on each Piwigo instance.
- [x] Piwigo Connector CORS origin is fixed to the Canva app origin.
- [ ] Review connector token permissions and expiration policy.
- [ ] Confirm connector logs do not contain tokens.
- [ ] Confirm media URLs with token query params are acceptable or replace with short-lived media tokens.

## Hosting

- [ ] Publish Piwigo Connector installation package.
- [ ] Confirm the user's Piwigo instance must be HTTPS.
- [ ] Remove or ignore central backend from production deployment.

## Testing

- [ ] Test with no saved Piwigo Connector connection.
- [ ] Test with invalid Piwigo URL.
- [ ] Test with invalid connector token.
- [ ] Test with existing connected user.
- [ ] Test with newly connected user.
- [ ] Test browsing albums with parent/child structure.
- [ ] Test empty album.
- [ ] Test inserting JPG.
- [ ] Test inserting PNG.
- [ ] Test exporting JPG to Piwigo.
- [ ] Test exporting PNG to Piwigo.
- [ ] Test multi-page export behavior.
- [ ] Test light theme.
- [ ] Test dark theme.
- [ ] Test required scopes in Developer Portal.

## Reviewer Access

- [ ] Provide test Piwigo URL.
- [ ] Provide Canva Connector token.
- [ ] Provide target album with upload permission.
- [ ] Provide short documentation explaining where albums/photos are located.
