import { ClerkProvider } from '@clerk/clerk-expo';
import { Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';
import * as SecureStore from 'expo-secure-store'; // Ye zaroori hai

const publishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  "pk_test_bWFpbi13b21iYXQtOTYuY2xlcmsuYWNjb3VudHMuZGV2JA";

if (!publishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Set it in your .env file.'
  );
}

// Token Cache ko manually define karein (Best Practice)
const tokenCache = {
  async getToken(key: string) {
    try {
      return SecureStore.getItemAsync(key);
    } catch (err) {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      return SecureStore.setItemAsync(key, value);
    } catch (err) {
      return;
    }
  },
};

export default function RootLayout() {
  const [showLaunchImage, setShowLaunchImage] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowLaunchImage(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ClerkProvider 
      publishableKey={publishableKey} 
      tokenCache={tokenCache}
      urlScheme="myapp"
    >
      {showLaunchImage ? (
        <View style={styles.launchContainer}>
          <ImageBackground
            source={require('@/assets/images/plant.png')}
            style={styles.launchImage}
            resizeMode="cover"
          />
        </View>
      ) : (
        <Slot />
      )}
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  launchContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  launchImage: {
    flex: 1,
  },
});
