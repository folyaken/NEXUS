import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// AES-256-CBC шифрование токенов подписок.
///
/// Ключ (256 бит) выводится через SHA-256 из секрета устройства, который
/// хранится локально. Для мобильных релизов секрет рекомендуется перенести
/// в защищённое хранилище ОС (Keychain / Android Keystore) через плагин
/// `flutter_secure_storage` — см. README, раздел «Безопасность».
class AesCipher {
  AesCipher._();

  static const _prefsKey = 'nexus_secret';

  static Future<Uint8List> _keyBytes() async {
    final secret = await _secret();
    return Uint8List.fromList(sha256.convert(utf8.encode(secret)).bytes);
  }

  static Future<String> _secret() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_prefsKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final fresh = _randomId(48);
    await prefs.setString(_prefsKey, fresh);
    return fresh;
  }

  static Encrypter _encrypter(Uint8List key) =>
      Encrypter(AES(Key(key), mode: AESMode.cbc, padding: 'PKCS7'));

  /// Шифрует строку. Результат — base64(iv + ciphertext).
  static Future<String> encrypt(String plain) async {
    final key = await _keyBytes();
    final iv = IV.fromSecureRandom(16);
    final encrypted = _encrypter(key).encrypt(plain, iv: iv);
    return base64Encode(iv.bytes + encrypted.bytes);
  }

  static Future<String> decrypt(String encoded) async {
    final key = await _keyBytes();
    final all = base64Decode(encoded);
    final iv = IV(Uint8List.fromList(all.sublist(0, 16)));
    final body = Encrypted(Uint8List.fromList(all.sublist(16)));
    return _encrypter(key).decrypt(body, iv: iv);
  }

  static String _randomId(int length) {
    const chars =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    final rand = Random.secure();
    return List.generate(length, (_) => chars[rand.nextInt(chars.length)]).join();
  }
}
