# Test inventory (Phase 1.3): Go tests → ported pytest files

One row per Go `func Test`, with a `cases: N` counter — the number of
`t.Run` subtests the Go test defines (1 when it has none). Naming rule:
`TestFooBar` → `test_foo_bar` (indicative — a Go test with several
subtests may map to several focused pytest cases). Status updated during
Phase 3: every row is `ported`.

## pkg/api + api/entry → tests_py/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestStripQueryParam | test_strip_query_param | cases: 1 | ported |
| TestHandlerRejectsForeignPath | test_handler_rejects_foreign_path | cases: 1 | ported |
| TestHandlerRestoresAPIPath | test_handler_restores_api_path | cases: 1 | ported |
| TestSpecLoads | test_spec_loads | cases: 1 | ported |
| TestMuxDispatchesEveryOperation | test_mux_dispatches_every_operation | cases: 1 | ported |
| TestHealthzProbePanicAnswers503WithMissingEnv | test_healthz_probe_panic_answers_503_with_missing_env | cases: 1 | ported |
| TestHealthzProbeFailureAnswers503 | test_healthz_probe_failure_answers_503 | cases: 1 | ported |
| TestHealthzHealthyAnswers200 | test_healthz_healthy_answers_200 | cases: 1 | ported |
| TestVercelRewritesCoverSpecPaths | test_vercel_rewrites_cover_spec_paths | cases: 1 | ported |
| TestHealthzRewrite | test_healthz_rewrite | cases: 1 | ported |
| TestMuxCoversSpecPaths | test_mux_covers_spec_paths | cases: 1 | ported |

## pkg/auth → tests_py/auth/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestLoginLinkRoundTrip | test_login_link_round_trip | cases: 1 | ported |
| TestLoginLinkUnknownToken | test_login_link_unknown_token | cases: 1 | ported |
| TestLoginLinkTTL | test_login_link_ttl | cases: 1 | ported |
| TestLoginLinkRejectsAbsoluteNext | test_login_link_rejects_absolute_next | cases: 1 | ported |
| TestLoginLinkAcceptsCabinetPaths | test_login_link_accepts_cabinet_paths | cases: 1 | ported |
| TestDerivedSigningKeyGolden | test_derived_signing_key_golden | cases: 1 | ported |
| TestVerifyOrganizerAuthValid | test_verify_organizer_auth_valid | cases: 1 | ported |
| TestVerifyOrganizerAuthWrongSecret | test_verify_organizer_auth_wrong_secret | cases: 1 | ported |
| TestVerifyOrganizerAuthExpired | test_verify_organizer_auth_expired | cases: 1 | ported |
| TestVerifyOrganizerAuthWithinClockTolerance | test_verify_organizer_auth_within_clock_tolerance | cases: 1 | ported |
| TestVerifyOrganizerAuthGarbage | test_verify_organizer_auth_garbage | cases: 1 | ported |
| TestVerifyOrganizerAuthWrongAlg | test_verify_organizer_auth_wrong_alg | cases: 1 | ported |
| TestVerifyOrganizerAuthEmptySub | test_verify_organizer_auth_empty_sub | cases: 1 | ported |
| TestSessionFromRequestNoHeader | test_session_from_request_no_header | cases: 1 | ported |
| TestSessionFromRequestValidHeader | test_session_from_request_valid_header | cases: 1 | ported |
| TestSessionFromRequestNoSecret | test_session_from_request_no_secret | cases: 1 | ported |
| TestValidateTelegramWidgetValid | test_validate_telegram_widget_valid | cases: 1 | ported |
| TestValidateTelegramWidgetNoUsername | test_validate_telegram_widget_no_username | cases: 1 | ported |
| TestValidateTelegramWidgetExpired | test_validate_telegram_widget_expired | cases: 1 | ported |
| TestValidateTelegramWidgetFutureRejected | test_validate_telegram_widget_future_rejected | cases: 1 | ported |
| TestValidateTelegramWidgetTampered | test_validate_telegram_widget_tampered | cases: 1 | ported |
| TestValidateTelegramWidgetWrongBotToken | test_validate_telegram_widget_wrong_bot_token | cases: 1 | ported |
| TestValidateTelegramWidgetMalformed | test_validate_telegram_widget_malformed | cases: 1 | ported |
| TestValidateTelegramWidgetNotConfigured | test_validate_telegram_widget_not_configured | cases: 1 | ported |
| TestValidateTelegramWidgetExtraField | test_validate_telegram_widget_extra_field | cases: 1 | ported |
| TestIssuePeekConsumeTicket | test_consume_ticket_unknown | cases: 1 | ported |
| TestConsumeTicketUnknown | test_ticket_ttl_expires | cases: 1 | ported |
| TestTicketTTLExpires | test_ticket_purpose_round_trip | cases: 1 | ported |
| TestTicketPurposeRoundTrip | test_consume_ticket_broken_payload | cases: 1 | ported |
| TestConsumeTicketBrokenPayload | test_consume_ticket_redis_down | cases: 1 | ported |
| TestConsumeTicketRedisDown | test_consume_ticket_redis_down | cases: 1 | ported |

## pkg/config → tests_py/config/test_config.py

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestValidateSkippedOutsideProduction | test_validate_skipped_outside_production | cases: 1 | ported |
| TestValidateProductionFull | test_validate_production_full | cases: 1 | ported |
| TestValidateProductionRefusals | test_validate_production_refusals | cases: 1 | ported |
| TestValidateAppURLShapes | test_validate_app_url_shapes | cases: 1 | ported |
| TestValidateStrictEnvOptsIn | test_validate_strict_env_opts_in | cases: 1 | ported |
| TestValidateNextSigningKeyOptional | test_validate_next_signing_key_optional | cases: 1 | ported |
| TestValidateVercelEnvCountsAsProduction | test_validate_vercel_env_counts_as_production | cases: 1 | ported |

## pkg/contracts → tests_py/contracts/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestGolden | test_golden | cases: 1 | ported |
| TestGoldenCoverage | test_golden_coverage | cases: 1 | ported |
| TestDomainVectors | test_domain_vectors | cases: 1 | ported |

## pkg/db → tests_py/db/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestCreateGuestBookingSuccess | test_create_guest_booking_success | cases: 1 | ported |
| TestCreateGuestBookingSoldOut | test_create_guest_booking_sold_out | cases: 1 | ported |
| TestCreateGuestBookingPastSlot | test_create_guest_booking_past_slot | cases: 1 | ported |
| TestCreateGuestBookingPartyTooLarge | test_create_guest_booking_party_too_large | cases: 1 | ported |
| TestCreateGuestBookingInvalidOptions | test_create_guest_booking_invalid_options | cases: 1 | ported |
| TestCreateGuestBookingDuplicate | test_create_guest_booking_duplicate | cases: 1 | ported |
| TestCreateGuestBookingDemoRefused | test_create_guest_booking_demo_refused | cases: 1 | ported |
| TestCancelGuestBookingByTokenSuccess | test_cancel_guest_booking_by_token_success | cases: 1 | ported |
| TestCancelGuestBookingIdempotent | test_cancel_guest_booking_idempotent | cases: 1 | ported |
| TestCancelGuestBookingUnknownToken | test_cancel_guest_booking_unknown_token | cases: 1 | ported |
| TestCancelGuestBookingExpiredToken | test_cancel_guest_booking_expired_token | cases: 1 | ported |
| TestCancelOwnedBookingSuccess | test_cancel_owned_booking_success | cases: 1 | ported |
| TestCancelOwnedBookingForeignService | test_cancel_owned_booking_foreign_service | cases: 1 | ported |
| TestCancelOwnedBookingDemoRefused | test_cancel_owned_booking_demo_refused | cases: 1 | ported |
| TestCreateGuestBookingConcurrentLastSeats | test_create_guest_booking_concurrent_last_seats | cases: 1 | ported |
| TestCanCancelBooking | test_can_cancel_booking | cases: 1 | ported |
| TestDBLayerRefusesDemoWrites | test_db_layer_refuses_demo_writes | cases: 1 | ported |
| TestDeleteOwnedSlotRefusesCancelledBookings | test_delete_owned_slot_refuses_cancelled_bookings | cases: 1 | ported |
| TestDeleteOwnedServiceRefusesBookings | test_delete_owned_service_refuses_bookings | cases: 1 | ported |
| TestPhotoURLReferenced | test_photo_url_referenced | cases: 1 | ported |
| TestOutboxSentRoundTrip | test_outbox_sent_round_trip | cases: 1 | ported |
| TestOutboxFailedIsTerminal | test_outbox_failed_is_terminal | cases: 1 | ported |
| TestSweepOutboxClaimsPendingWithoutSpendingBudget | test_sweep_outbox_claims_pending_without_spending_budget | cases: 1 | ported |
| TestOutboxSkippedIsTerminal | test_outbox_skipped_is_terminal | cases: 1 | ported |
| TestOutboxBacklogAndRetention | test_outbox_backlog_and_retention | cases: 1 | ported |
| TestParseStringArray | test_parse_string_array | cases: 1 | ported |
| TestNewServiceIDShape | test_new_service_id_shape | cases: 1 | ported |
| TestHashManageTokenParity | test_hash_manage_token_parity | cases: 1 | ported |
| TestNewManageTokenShape | test_new_manage_token_shape | cases: 1 | ported |

## pkg/demo

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestIsReadOnly | test_is_read_only | cases: 1 | ported |
| TestAssertNotDemo | test_assert_not_demo | cases: 1 | ported |
| TestResolveCabinetOrganizerIDAnonymous | test_resolve_cabinet_organizer_id_anonymous | cases: 1 | ported |
| TestResolveCabinetOrganizerIDSignedIn | test_resolve_cabinet_organizer_id_signed_in | cases: 1 | ported |
| TestResolveCabinetOrganizerIDDemoSession | test_resolve_cabinet_organizer_id_demo_session | cases: 1 | ported |
| TestResolveCabinetOrganizerIDBrokenToken | test_resolve_cabinet_organizer_id_broken_token | cases: 1 | ported |

## pkg/httpx → tests_py/httpx_/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestBookingErrorResponse | test_booking_error_response | cases: 1 | ported |
| TestBookingErrorResponseWrapped | test_booking_error_response_wrapped | cases: 1 | ported |
| TestSlotServiceOrganizerErrorResponseWrapped | test_slot_service_organizer_error_response_wrapped | cases: 1 | ported |
| TestBookingErrorResponseUnknown | test_booking_error_response_unknown | cases: 1 | ported |
| TestBookingErrorResponseLocalized | test_booking_error_response_localized | cases: 1 | ported |
| TestSlotErrorResponse | test_slot_error_response | cases: 1 | ported |
| TestServiceErrorResponse | test_service_error_response | cases: 1 | ported |
| TestOrganizerErrorResponse | test_organizer_error_response | cases: 1 | ported |
| TestInternalLeaksNothing | test_internal_leaks_nothing | cases: 1 | ported |
| TestRequireWritableOrganizerAnonymous | test_require_writable_organizer_anonymous | cases: 1 | ported |
| TestRequireWritableOrganizerDemoSession | test_require_writable_organizer_demo_session | cases: 1 | ported |
| TestRequireWritableOrganizerSignedIn | test_require_writable_organizer_signed_in | cases: 1 | ported |
| TestRequireWritableOrganizerRateLimit | test_require_writable_organizer_rate_limit | cases: 1 | ported |
| TestRequireGuestIdentityConsumeOnce | test_require_guest_identity_consume_once | cases: 1 | ported |
| TestRequireGuestIdentityUnknownTicket | test_require_guest_identity_unknown_ticket | cases: 1 | ported |
| TestRequireGuestIdentitySignupPurposeRefused | test_require_guest_identity_signup_purpose_refused | cases: 1 | ported |
| TestRequireGuestIdentityBrokenPayload | test_require_guest_identity_broken_payload | cases: 1 | ported |
| TestRequireGuestIdentityRedisDown | test_require_guest_identity_redis_down | cases: 1 | ported |
| TestAllowFailsOpenWithoutRedis | test_allow_fails_open_without_redis | cases: 1 | ported |
| TestClientIP | test_client_ip | cases: 1 | ported |
| TestRecoverSetsHeaders | test_recover_sets_headers | cases: 1 | ported |
| TestRecoverPanicsAnswer500 | test_recover_panics_answer_500 | cases: 1 | ported |
| TestResponseWrite | test_response_write | cases: 5 | ported |
| TestFlushIsBestEffort | test_flush_is_best_effort | cases: 1 | ported |
| TestInvalidBodyRenderers | test_invalid_body_renderers | cases: 3 | ported |
| TestInvalidIssuesRenderers | test_invalid_issues_renderers | cases: 3 | ported |
| TestReadBodyOr413 | test_read_body_or_413 | cases: 3 | ported |
| TestRateLimitedFailsOpen | test_rate_limited_fails_open | cases: 1 | ported |

## pkg/i18n → tests_py/i18n/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestFormatSimplePlaceholder | test_format_simple_placeholder | cases: 1 | ported |
| TestFormatMissingParamRendersAsIs | test_format_missing_param_renders_as_is | cases: 1 | ported |
| TestFormatPluralEn | test_format_plural_en | cases: 1 | ported |
| TestFormatPluralRu | test_format_plural_ru | cases: 1 | ported |
| TestFormatPluralAr | test_format_plural_ar | cases: 1 | ported |
| TestFormatPluralFrZeroIsOne | test_format_plural_fr_zero_is_one | cases: 1 | ported |
| TestApiError | test_api_error | cases: 1 | ported |
| TestNotifTopLevelAndSection | test_notif_top_level_and_section | cases: 1 | ported |
| TestNotifFallbackToEnglish | test_notif_fallback_to_english | cases: 1 | ported |
| TestApiErrorKeysComplete | test_api_error_keys_complete | cases: 1 | ported |

## pkg/jobs → tests_py/jobs/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestHandleBookingCreatedPerRecipient | test_handle_booking_created_per_recipient | cases: 1 | ported |
| TestHandleBookingCreatedMintsLoginLink | test_handle_booking_created_mints_login_link | cases: 1 | ported |
| TestHandleBookingDemoRefused | test_handle_booking_demo_refused | cases: 1 | ported |
| TestHandleBookingMissingIsSilentSkip | test_handle_booking_missing_is_silent_skip | cases: 1 | ported |
| TestHandleBookingCancelledCounterpartyOnly | test_handle_booking_cancelled_counterparty_only | cases: 1 | ported |
| TestHandleOutboxSweepPublishesAndMarksSent | test_handle_outbox_sweep_publishes_and_marks_sent | cases: 1 | ported |
| TestHandleOutboxSweepMovesExhaustedToFailed | test_handle_outbox_sweep_moves_exhausted_to_failed | cases: 1 | ported |
| TestHandleOutboxSweepStopsOnBudget | test_handle_outbox_sweep_stops_on_budget | cases: 1 | ported |
| TestHandleDemoRefreshReseeds | test_handle_demo_refresh_reseeds | cases: 1 | ported |
| TestSendMessageUnreachableIsTerminal | test_send_message_unreachable_is_terminal | cases: 1 | ported |
| TestSendMessageTransientIsRetryable | test_send_message_transient_is_retryable | cases: 1 | ported |
| TestSendMessageEscapedMessageIsAccepted | test_send_message_escaped_message_is_accepted | cases: 1 | ported |
| TestVerifyQStashSignatureCurrentKey | test_verify_qstash_signature_current_key | cases: 1 | ported |
| TestVerifyQStashSignatureRotation | test_verify_qstash_signature_rotation | cases: 1 | ported |
| TestVerifyQStashSignatureBodyMismatch | test_verify_qstash_signature_body_mismatch | cases: 1 | ported |
| TestVerifyQStashSignatureExpired | test_verify_qstash_signature_expired | cases: 1 | ported |
| TestVerifyQStashSignatureWrongIssuer | test_verify_qstash_signature_wrong_issuer | cases: 1 | ported |
| TestVerifyQStashSignatureWrongSub | test_verify_qstash_signature_wrong_sub | cases: 1 | ported |
| TestVerifyQStashSignatureGarbage | test_verify_qstash_signature_garbage | cases: 1 | ported |
| TestVerifyQStashSignaturePaddedBodyClaim | test_verify_q_stash_signature_padded_body_claim | cases: 1 | ported |
| TestRunJobUnknownQueue | test_run_job_unknown_queue | cases: 1 | ported |
| TestRunJobBookingCreatedInvalidPayloads | test_run_job_booking_created_invalid_payloads | cases: 1 | ported |
| TestRunJobBookingCancelledInvalidPayloads | test_run_job_booking_cancelled_invalid_payloads | cases: 1 | ported |
| TestRunJobValidPayloadReachesEnvCheck | test_run_job_valid_payload_reaches_env_check | cases: 1 | ported |
| TestCheckPayloadScheduleQueuesAcceptEmptyBody | test_check_payload_schedule_queues_accept_empty_body | cases: 1 | ported |
| TestCheckPayloadUnknownQueue | test_check_payload_unknown_queue | cases: 1 | ported |
| TestWithRetryPolicyAbsorbsUnreachable | test_with_retry_policy_absorbs_unreachable | cases: 1 | ported |
| TestWithRetryPolicyPropagatesTransient | test_with_retry_policy_propagates_transient | cases: 1 | ported |
| TestWithRetryPolicySuccess | test_with_retry_policy_success | cases: 1 | ported |
| TestRunClaimedReleasesClaimOnRetryableFailure | test_run_claimed_releases_claim_on_retryable_failure | cases: 1 | ported |
| TestRunClaimedSuppressesDuplicateAfterSuccess | test_run_claimed_suppresses_duplicate_after_success | cases: 1 | ported |
| TestRunClaimedKeepsClaimOnAbsorbedTerminalError | test_run_claimed_keeps_claim_on_absorbed_terminal_error | cases: 1 | ported |
| TestValidBookingID | test_valid_booking_id | cases: 1 | ported |
| TestValidRecipient | test_valid_recipient | cases: 1 | ported |
| TestEscapeHTML | test_escape_html | cases: 1 | ported |
| TestRenderedMessagesEscapeUserInput | test_rendered_messages_escape_user_input | cases: 1 | ported |
| TestNotificationLocale | test_notification_locale | cases: 1 | ported |
| TestFormatInstantAlwaysInOrganizerTimezone | test_format_instant_always_in_organizer_timezone | cases: 1 | ported |
| TestBookingLinesPricePrecedence | test_booking_lines_price_precedence | cases: 1 | ported |
| TestBookingLinesOptionsAndSeats | test_booking_lines_options_and_seats | cases: 1 | ported |
| TestOrganizerDetailLinesOverride | test_organizer_detail_lines_override | cases: 1 | ported |
| TestBookingCreatedForOrganizerFullVsStillFree | test_booking_created_for_organizer_full_vs_still_free | cases: 1 | ported |
| TestMessageButtonsCarryURLs | test_message_buttons_carry_urls | cases: 1 | ported |
| TestGoldenNotifications | test_golden_notifications | cases: 1 | ported |

## pkg/queue → tests_py/queue/test_qstash.py

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestPublishOutboxHeaders | test_publish_outbox_headers | cases: 1 | ported |
| TestPublishOutboxDevSkipsWithoutToken | test_publish_outbox_dev_skips_without_token | cases: 1 | ported |
| TestPublishOutboxProdRequiresToken | test_publish_outbox_prod_requires_token | cases: 1 | ported |
| TestPublishOutboxUnreachableIsError | test_publish_outbox_unreachable_is_error | cases: 1 | ported |
| TestPublishOutboxNon2xxIsError | test_publish_outbox_non_2xx_is_error | cases: 1 | ported |
| TestPublishOutboxRequiresAppURL | test_publish_outbox_requires_app_url | cases: 1 | ported |

## pkg/routes → tests_py/routes/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestBookingCreateRateLimit | test_booking_create_rate_limit | cases: 1 | ported |
| TestBookingCreateInvalidBody | test_booking_create_invalid_body | cases: 1 | ported |
| TestBookingCreateUnknownTicket | test_booking_create_unknown_ticket | cases: 1 | ported |
| TestBookingCreateRawMessengerIdIgnored | test_booking_create_raw_messenger_id_ignored | cases: 1 | ported |
| TestBookingLookupInvalidBody | test_booking_lookup_invalid_body | cases: 1 | ported |
| TestBookingLookupUnknownTicket | test_booking_lookup_unknown_ticket | cases: 1 | ported |
| TestBookingCancelRateLimit | test_booking_cancel_rate_limit | cases: 1 | ported |
| TestBookingCancelInvalidBody | test_booking_cancel_invalid_body | cases: 1 | ported |
| TestBookingCancelByOrganizerAnonymous | test_booking_cancel_by_organizer_anonymous | cases: 1 | ported |
| TestBookingCancelByOrganizerDemoSession | test_booking_cancel_by_organizer_demo_session | cases: 1 | ported |
| TestBookingCancelByOrganizerInvalidBody | test_booking_cancel_by_organizer_invalid_body | cases: 1 | ported |
| TestPublishOutboxRowsAbsorbsPublishErrors | test_publish_outbox_rows_absorbs_publish_errors | cases: 1 | ported |
| TestBookingCreateHappyPath | test_booking_create_happy_path | cases: 1 | ported |
| TestBookingCreateSoldOutMaps409 | test_booking_create_sold_out_maps_409 | cases: 1 | ported |
| TestBookingCancelUnknownTokenIs404 | test_booking_cancel_unknown_token_is_404 | cases: 1 | ported |
| TestJobsReceiverSigningKeysNotSet | test_jobs_receiver_signing_keys_not_set | cases: 1 | ported |
| TestJobsReceiverMissingSignature | test_jobs_receiver_missing_signature | cases: 1 | ported |
| TestJobsReceiverBadSignature | test_jobs_receiver_bad_signature | cases: 1 | ported |
| TestJobsReceiverUnknownQueue | test_jobs_receiver_unknown_queue | cases: 1 | ported |
| TestJobsReceiverInvalidPayload | test_jobs_receiver_invalid_payload | cases: 1 | ported |
| TestJobsReceiverInvalidJSON | test_jobs_receiver_invalid_json | cases: 1 | ported |
| TestJobsReceiverHandlerFailureIs500 | test_jobs_receiver_handler_failure_is_500 | cases: 1 | ported |
| TestJobsReceiverEmptyBodyIsNotJSON | test_jobs_receiver_empty_body_is_not_json | cases: 1 | ported |
| TestMergePatchClearsOptionsPair | test_merge_patch_clears_options_pair | cases: 1 | ported |
| TestMergePatchKeepsAbsentKeys | test_merge_patch_keeps_absent_keys | cases: 1 | ported |
| TestPatchKeys | test_patch_keys | cases: 1 | ported |
| TestMergePatchPreservesNullOptions | test_merge_patch_preserves_null_options | cases: 1 | ported |
| TestMergePatchSlotStartsAt | test_merge_patch_slot_starts_at | cases: 1 | ported |

## pkg/storage → tests_py/storage/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestIsOwnMediaURL | test_is_own_media_url | cases: 1 | ported |
| TestMediaKeyFromURL | test_media_key_from_url | cases: 1 | ported |
| TestMediaKeyFromURLWithBasePath | test_media_key_from_url_with_base_path | cases: 1 | ported |
| TestMediaKeyFromURLRoundTripsPublicURL | test_media_key_from_url_round_trips_public_url | cases: 1 | ported |
| TestDeleteReplacedMedia | test_delete_replaced_media | cases: 1 | ported |
| TestDeleteReplacedMediaUnconfiguredStorage | test_delete_replaced_media_unconfigured_storage | cases: 1 | ported |
| TestSignedUploadURLMissingEnvIsErrorNotPanic | test_signed_upload_url_missing_env_is_error_not_panic | cases: 1 | ported |
| TestSignedUploadURLShape | test_signed_upload_url_shape | cases: 1 | ported |
| TestDeleteObjectMissingEnvIsErrorNotPanic | test_delete_object_missing_env_is_error_not_panic | cases: 1 | ported |
| TestDeleteObjectEmptyKeyIsError | test_delete_object_empty_key_is_error | cases: 1 | ported |

## pkg/validation → tests_py/validation/

| Go test | pytest name | Cases | Status |
| --- | --- | --- | --- |
| TestTimezoneRuleIANA | test_timezone_rule_iana | cases: 1 | ported |
| TestDecodeCreateBookingInputValid | test_decode_create_booking_input_valid | cases: 1 | ported |
| TestDecodeCreateBookingInputDefaultsAndErrors | test_decode_create_booking_input_defaults_and_errors | cases: 1 | ported |
| TestDecodeCreateBookingInputMalformedBodies | test_decode_create_booking_input_malformed_bodies | cases: 1 | ported |
| TestDecodeCreateServiceInputOptionsConsistency | test_decode_create_service_input_options_consistency | cases: 1 | ported |
| TestDecodeUpdateServiceInputNonNullableNullRejected | test_decode_update_service_input_non_nullable_null_rejected | cases: 1 | ported |
| TestDecodeUpdateServiceInputPartialOptionsMode | test_decode_update_service_input_partial_options_mode | cases: 1 | ported |
| TestDecodeCreateTimeSlotInputPastRejected | test_decode_create_time_slot_input_past_rejected | cases: 1 | ported |
| TestDecodeRegisterOrganizerInputSlugRules | test_decode_register_organizer_input_slug_rules | cases: 1 | ported |
| TestDecodeUpdateOrganizerProfileInput | test_decode_update_organizer_profile_input | cases: 1 | ported |
| TestDecodeCancelAndLookupInputs | test_decode_cancel_and_lookup_inputs | cases: 1 | ported |
| TestDecodeStorageInputs | test_decode_storage_inputs | cases: 1 | ported |
| TestStringLengthCountsCodePoints | test_string_length_counts_code_points | cases: 1 | ported |
| TestTrimTransformApplies | test_trim_transform_applies | cases: 1 | ported |
| TestRefineServiceMergedState | test_refine_service_merged_state | cases: 1 | ported |
| TestRawObjectKinds | test_raw_object_kinds | cases: 1 | ported |
| TestTrimJSONValue | test_trim_json_value | cases: 1 | ported |
| TestValidationVectors | test_validation_vectors | cases: 1 | ported |

