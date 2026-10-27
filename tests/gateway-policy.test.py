import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps' / 'browser'))
from request_policy import canonical_path, matching_operation, body_allowed, preflight_allowed

class RequestPolicyTests(unittest.TestCase):
    def setUp(self):
        self.grant = {'namespace': 'oddhound_test', 'fixtureIds': ['owned-1'], 'operations': [
            {'origin': 'https://owned.example', 'method': 'POST', 'path': '/records', 'effect': 'create', 'body': {'encoding': 'json', 'field': 'record.name', 'match': 'namespace_prefix'}},
            {'origin': 'https://owned.example', 'method': 'POST', 'path': '/records/:fixture/cancel', 'effect': 'cancel'}]}

    def test_fixture_path_is_bound_to_approved_id(self):
        self.assertIsNotNone(matching_operation(self.grant, 'https://owned.example', 'POST', '/records/owned-1/cancel'))
        for origin, method, path in [('https://other.example', 'POST', '/records/owned-1/cancel'), ('https://owned.example', 'DELETE', '/records/owned-1/cancel'), ('https://owned.example', 'POST', '/records/foreign-1/cancel')]:
            self.assertIsNone(matching_operation(self.grant, origin, method, path))

    def test_namespace_body_checks_exact_encoding_and_rejects_duplicate_fields(self):
        operation = self.grant['operations'][0]
        self.assertTrue(body_allowed(self.grant, operation, 'application/json', b'{"record":{"name":"oddhound_test_control"}}'))
        for body in [b'{"record":{"name":"customer_record"}}', b'{"record":{"name":"oddhound_testx_record"}}', b'{"record":{"name":"oddhound_test_yes","name":"customer"}}']:
            self.assertFalse(body_allowed(self.grant, operation, 'application/json', body))
        operation = {'effect': 'register', 'path': '/signup', 'body': {'encoding': 'form', 'field': 'username', 'match': 'namespace_prefix'}}
        self.assertTrue(body_allowed(self.grant, operation, 'application/x-www-form-urlencoded', b'username=oddhound_test_a', 'oddhound_test'))
        self.assertFalse(body_allowed(self.grant, operation, 'application/x-www-form-urlencoded', b'username=oddhound_test_a&username=customer', 'oddhound_test'))
        self.assertFalse(body_allowed(self.grant, operation, 'application/json', b'{"username":"oddhound_test_a"}', 'oddhound_test'))
        self.assertFalse(body_allowed(self.grant, operation, 'application/x-www-form-urlencoded', b'username=oddhound_test_a%40foreign.example', 'oddhound_test', 'owned.example'))
        self.assertTrue(body_allowed(self.grant, operation, 'application/x-www-form-urlencoded', b'username=oddhound_test_a%40owned.example', 'oddhound_test', 'owned.example'))

    def test_encoded_or_ambiguous_paths_do_not_bypass_literal_denials(self):
        self.assertEqual(canonical_path('/%61dmin'), '/admin')
        for path in ['/a%2fb', '/a%5cb', '/%2561dmin', '/a/../admin', '//admin']:
            with self.assertRaises(ValueError):
                canonical_path(path)

    def test_preflight_only_carries_existing_origin_method_and_operation_authority(self):
        self.grant['mode'] = 'mapped'
        self.assertTrue(preflight_allowed(self.grant, 'https://owned.example', 'POST', '/records', 'https://ui.example', 'https://ui.example', {'GET', 'POST'}))
        self.assertFalse(preflight_allowed(self.grant, 'https://owned.example', 'DELETE', '/records', 'https://ui.example', 'https://ui.example', {'GET', 'POST'}))
        self.assertFalse(preflight_allowed(self.grant, 'https://owned.example', 'POST', '/records', 'https://resource.example', 'https://ui.example', {'POST'}))
        self.assertFalse(preflight_allowed(self.grant, 'https://owned.example', 'POST', '/unmapped', 'https://ui.example', 'https://ui.example', {'POST'}))

if __name__ == '__main__':
    unittest.main()
