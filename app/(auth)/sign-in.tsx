import { useSignIn } from '@clerk/clerk-expo'
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
    View
} from 'react-native'
import Animated, { FadeInDown, FadeInUp, Layout } from 'react-native-reanimated'

type SignInFormValues = {
  emailAddress: string
  password: string
}

export default function Page() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const router = useRouter()

  const [submitting, setSubmitting] = React.useState(false)

  const {
    control,
    handleSubmit,
  } = useForm<SignInFormValues>({
    defaultValues: {
      emailAddress: '',
      password: '',
    },
  })

  const showError = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT)
    } else {
      Alert.alert('Error', message)
    }
  }

  // Handle the submission of the sign-in form
  const onSignInPress = async ({ emailAddress, password }: SignInFormValues) => {
    if (!isLoaded || submitting) return

    try {
      setSubmitting(true)
      const signInAttempt = await signIn.create({
        identifier: emailAddress,
        password,
      })

      console.log('[SignIn] status:', signInAttempt.status)

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId })
        router.replace('/')
      } else if (
        signInAttempt.status === 'needs_first_factor' ||
        signInAttempt.status === 'needs_identifier'
      ) {
        showError(
          'Your email is not verified. Please sign up again to receive a new verification code.'
        )
      } else {
        console.warn('[SignIn] Unexpected status:', signInAttempt.status)
        showError('Unable to sign in. Please try again.')
      }
    } catch (err: any) {
      const clerkErr = err?.errors?.[0]
      const code = clerkErr?.code ?? ''
      const message = clerkErr?.message ?? 'Unable to sign in'
      console.error('[SignIn] Error code:', code, '| message:', message)

      if (code === 'form_password_incorrect') {
        showError('Incorrect password. Please try again.')
      } else if (code === 'form_identifier_not_found') {
        showError('No account found with this email. Please sign up first.')
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
    if (message) {
      showError(message)
    }
  }

  // Show loading state while Clerk is initializing
  if (!isLoaded) {
    return (
      <LinearGradient colors={['#f0fdf4', '#ecfdf5', '#f0fdfa']} style={styles.safeArea}>
        <SafeAreaView style={styles.safeAreaInner}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#059669" />
            <Text style={styles.loadingText}>Loading authentication...</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    )
  }

  return (
    <LinearGradient colors={['#f0fdf4', '#ecfdf5', '#f0fdfa']} style={styles.safeArea}>
      <SafeAreaView style={styles.safeAreaInner}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.wrapper}
        >
          <Animated.View
            style={styles.card}
            entering={FadeInUp.duration(350)}
            layout={Layout.springify()}
          >
            <Animated.View entering={FadeInDown.duration(350)} layout={Layout.springify()}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to continue</Text>
            </Animated.View>

            <Animated.View style={styles.field} entering={FadeInUp.duration(300).delay(120)}>
              <Text style={styles.label}>Email</Text>
              <Controller
                control={control}
                name="emailAddress"
                rules={{
                  required: 'Email is required',
                  pattern: {
                    value: /\S+@\S+\.\S+/,
                    message: 'Enter a valid email address',
                  },
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

            <Animated.View style={styles.field} entering={FadeInUp.duration(300).delay(170)}>
              <Text style={styles.label}>Password</Text>
              <Controller
                control={control}
                name="password"
                rules={{
                  required: 'Password is required',
                  minLength: {
                    value: 6,
                    message: 'Password must be at least 6 characters',
                  },
                }}
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={styles.input}
                    value={value}
                    placeholder="••••••••"
                    placeholderTextColor="#9AA0B4"
                    secureTextEntry
                    onBlur={onBlur}
                    onChangeText={onChange}
                  />
                )}
              />
            </Animated.View>

            <Animated.View entering={FadeInUp.duration(300).delay(220)}>
              <TouchableOpacity
                style={[styles.button, submitting && styles.buttonDisabled]}
                disabled={submitting}
                onPress={handleSubmit(onSignInPress, onInvalid)}
              >
                <Text style={styles.buttonText}>{submitting ? 'Please wait...' : 'Continue'}</Text>
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={styles.footer} entering={FadeInUp.duration(300).delay(260)}>
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
  safeArea: {
    flex: 1,
  },
  safeAreaInner: {
    flex: 1,
  },
  wrapper: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
    color: '#064e3b',
    textTransform: 'capitalize',
  },
  subtitle: {
    fontSize: 16,
    color: '#059669',
    marginBottom: 24,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: '#065f46',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#064e3b',
    backgroundColor: '#f0fdf4',
  },
  button: {
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    gap: 4,
  },
  footerText: {
    color: '#065f46',
  },
  footerLink: {
    color: '#047857',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#065f46',
    fontWeight: '600',
  },
})
