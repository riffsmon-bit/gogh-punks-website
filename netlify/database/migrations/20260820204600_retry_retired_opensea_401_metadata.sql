-- One-time retry for cache rows produced while the retired OpenSea NFT endpoint
-- rejected an otherwise valid API key. The current metadata endpoint will
-- refresh these rows on the next scheduled run; history and attempt counts stay
-- intact.
UPDATE broker_nft_metadata
   SET refresh_after = NOW()
 WHERE source = 'OPENSEA_V2'
   AND metadata_status = 'ERROR'
   AND last_error_code = 'OPENSEA_HTTP_401';
