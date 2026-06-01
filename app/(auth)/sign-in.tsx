import { useOAuth, useSignIn } from '@clerk/clerk-expo'
import * as WebBrowser from 'expo-web-browser'
import { LinearGradient } from 'expo-linear-gradient'
import { Link, useRouter } from 'expo-router'
import * as React from 'react'
import { Controller, useForm, type FieldErrors } from 'react-hook-form'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native'
import Animated, { FadeInDown, FadeInUp, LinearTransition } from 'react-native-reanimated'

WebBrowser.maybeCompleteAuthSession()

type SignInFormValues = {
  emailAddress: string
  password: string
}

export default function Page() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const router = useRouter()

  const { startOAuthFlow: startGoogleFlow } = useOAuth({ strategy: 'oauth_google' })
  const { startOAuthFlow: startFacebookFlow } = useOAuth({ strategy: 'oauth_facebook' })

  const [submitting, setSubmitting] = React.useState(false)
  const [oauthLoading, setOauthLoading] = React.useState<'google' | 'facebook' | null>(null)

  const { control, handleSubmit } = useForm<SignInFormValues>({
    defaultValues: { emailAddress: '', password: '' },
  })

  const showError = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT)
    } else {
      Alert.alert('Error', message)
    }
  }

  const onSignInPress = async ({ emailAddress, password }: SignInFormValues) => {
    if (!isLoaded || submitting) return
    try {
      setSubmitting(true)
      const signInAttempt = await signIn.create({ identifier: emailAddress, password })

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId })
        router.replace('/')
      } else if (
        signInAttempt.status === 'needs_first_factor' ||
        signInAttempt.status === 'needs_identifier'
      ) {
        showError('Your email is not verified. Please sign up again.')
      } else {
        showError('Unable to sign in. Please try again.')
      }
    } catch (err: any) {
      const code = err?.errors?.[0]?.code ?? ''
      const message = err?.errors?.[0]?.message ?? 'Unable to sign in'
      if (code === 'form_password_incorrect') {
        showError('Incorrect password. Please try again.')
      } else if (code === 'form_identifier_not_found') {
        showError('No account found with this email.')
      } else {
        showError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onInvalid = (formErrors: FieldErrors<SignInFormValues>) => {
    const firstError = Object.values(formErrors)[0]
    const message =
      typeof firstError === 'object' && firstError && 'message' in firstError
        ? String(firstError.message)
        : null
    if (message) showError(message)
  }

  const handleOAuth = async (provider: 'google' | 'facebook') => {
    if (oauthLoading) return
    try {
      setOauthLoading(provider)
      const startFlow = provider === 'google' ? startGoogleFlow : startFacebookFlow
      const { createdSessionId, setActive: setOAuthActive } = await startFlow()
      if (createdSessionId && setOAuthActive) {
        await setOAuthActive({ session: createdSessionId })
        router.replace('/')
      }
    } catch (err: any) {
      showError(`${provider === 'google' ? 'Google' : 'Facebook'} sign in failed. Please try again.`)
    } finally {
      setOauthLoading(null)
    }
  }

  if (!isLoaded) {
    return (
      <LinearGradient colors={['#f8fafc', '#eef2ff', '#ecfeff']} style={styles.safeArea}>
        <SafeAreaView style={styles.safeAreaInner}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#059669" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    )
  }

  return (
    <LinearGradient colors={['#f8fafc', '#eef2ff', '#ecfeff']} style={styles.safeArea}>
      <SafeAreaView style={styles.safeAreaInner}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.wrapper}
        >
          <Animated.View style={styles.card} entering={FadeInUp.duration(350)} layout={LinearTransition}>
            <Animated.View entering={FadeInDown.duration(350)} layout={LinearTransition}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to continue</Text>
            </Animated.View>

            {/* Google Button */}
            <Animated.View entering={FadeInUp.duration(300).delay(80)}>
              <TouchableOpacity
                style={[styles.oauthButton, styles.googleButton, oauthLoading === 'google' && styles.buttonDisabled]}
                onPress={() => handleOAuth('google')}
                disabled={!!oauthLoading}
                activeOpacity={0.85}
              >
                {oauthLoading === 'google' ? (
                  <ActivityIndicator size="small" color="#3c4043" />
                ) : (
                  <Text style={styles.googleIcon}>G</Text>
                )}
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Facebook Button */}
            <Animated.View entering={FadeInUp.duration(300).delay(120)}>
              <TouchableOpacity
                style={[styles.oauthButton, styles.facebookButton, oauthLoading === 'facebook' && styles.buttonDisabled]}
                onPress={() => handleOAuth('facebook')}
                disabled={!!oauthLoading}
                activeOpacity={0.85}
              >
                {oauthLoading === 'facebook' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.facebookIcon}>f</Text>
                )}
                <Text style={styles.facebookButtonText}>Continue with Facebook</Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Divider */}
            <Animated.View style={styles.dividerRow} entering={FadeInUp.duration(300).delay(150)}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </Animated.View>

            {/* Email */}
            <Animated.View style={styles.field} entering={FadeInUp.duration(300).delay(180)}>
              <Text style={styles.label}>Email</Text>
              <Controller
                control={control}
                name="emailAddress"
                rules={{
                  required: 'Email is required',
                  pattern: { value: /\S+@\S+\.\S+/, message: 'Enter a valid email' },
                }}
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={styles.input}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={value}
                    placeholder="you@example.com"
                    placeholderTextColor="#9AA0B4"
                    onBlur={onBlur}
                    onChangeText={onChange}
                  />
                )}
              />
            </Animated.View>

            {/* Password */}
            <Animated.View style={styles.field} entering={FadeInUp.duration(300).delay(220)}>
              <Text style={styles.label}>Password</Text>
              <Controller
                control={control}
                name="password"
                rules={{
                  required: 'Password is required',
                  minLength: { value: 6, message: 'Password must be at least 6 characters' },
                }}
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={styles.input}
                    value={value}
                    placeholder="........"
                    placeholderTextColor="#9AA0B4"
                    secureTextEntry
                    onBlur={onBlur}
                    onChangeText={onChange}
                  />
                )}
              />
            </Animated.View>

            {/* Submit */}
            <Animated.View entering={FadeInUp.duration(300).delay(260)}>
              <TouchableOpacity
                style={[styles.button, submitting && styles.buttonDisabled]}
                disabled={submitting || !!oauthLoading}
                onPress={handleSubmit(onSignInPress, onInvalid)}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.buttonText}>Sign In</Text>
                }
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={styles.footer} entering={FadeInUp.duration(300).delay(290)}>
              <Text style={styles.footerText}>Don't have an account?</Text>
              <Link href="/(auth)/sign-up">
                <Text style={styles.footerLink}>Sign up</Text>
              </Link>
            </Animated.View>
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  safeAreaInner: { flex: 1 },
  wrapper: { flex: 1, padding: 24, justifyContent: 'center' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 22,
    padding: 26,
    shadowColor: '#1e293b',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
    gap: 6,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 4,
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 18,
  },
  // OAuth buttons
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 13,
    gap: 10,
    marginBottom: 10,
  },
  googleButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1.25,
    borderColor: '#dbe3ec',
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4285F4',
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3c4043',
  },
  facebookButton: {
    backgroundColor: '#1877F2',
  },
  facebookIcon: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
  },
  facebookButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '500',
  },
  // Form
  field: { marginBottom: 12 },
  label: { fontSize: 14, color: '#1e293b', marginBottom: 8, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    gap: 4,
  },
  footerText: { color: '#475569' },
  footerLink: { color: '#2563eb', fontWeight: '700' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { fontSize: 16, color: '#334155', fontWeight: '600' },
})
