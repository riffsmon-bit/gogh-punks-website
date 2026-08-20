-- OpenSea's current metadata endpoint returns SeaDN display images from both
-- i.seadn.io and raw2.seadn.io. Replace the original single-host constraint
-- without weakening protocol, credential, port, fragment, or control-character
-- restrictions.
ALTER TABLE broker_nft_metadata
  DROP CONSTRAINT IF EXISTS broker_nft_metadata_display_image_url_check;

ALTER TABLE broker_nft_metadata
  ADD CONSTRAINT broker_nft_metadata_display_image_url_check
  CHECK (
    display_image_url IS NULL
    OR (
      (
        display_image_url LIKE 'https://i.seadn.io/%'
        OR display_image_url LIKE 'https://raw2.seadn.io/%'
      )
      AND display_image_url NOT LIKE '%#%'
      AND display_image_url !~ '[[:cntrl:]]'
    )
  );
