package com.cinepulse.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM key remains inside Android Keystore. No token in source, backups, or logs. */
final class SecureTokenStore {
    private static final String ALIAS = "CinePulse.Mobile.Token.v1";
    private static final String PREF = "cinepulse_secure_session_v1";
    private final SharedPreferences prefs;
    SecureTokenStore(Context context) { prefs=context.getSharedPreferences(PREF, Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    void save(String token) throws Exception {
        if(token == null || token.trim().length() < 16) throw new IllegalArgumentException("Credential is missing or too short");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] data=cipher.doFinal(token.trim().getBytes(StandardCharsets.UTF_8));
        prefs.edit().putString("iv", Base64.getEncoder().encodeToString(cipher.getIV()))
                .putString("token",Base64.getEncoder().encodeToString(data)).commit();
    }
    String load() throws Exception {
        String iv=prefs.getString("iv",null),ct=prefs.getString("token",null);
        if(iv==null||ct==null)return null;
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.getDecoder().decode(iv)));
        return new String(cipher.doFinal(Base64.getDecoder().decode(ct)),StandardCharsets.UTF_8);
    }
    void clear() { prefs.edit().clear().commit(); }
}
