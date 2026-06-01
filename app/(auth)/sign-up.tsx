import { useSignUp } from '@clerk/clerk-expo'
import { LinearGradient } from 'expo-linear-gradient'
import { Link, useRouter } from 'expo-router'
import * as React from 'react'
import { Controller, useForm, type FieldErrors } from 'react-hook-form'
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    ToastAndroid,
    TouchableOpacity
} from 'react-native'
import Animated, { FadeInDown, FadeInUp, Layout } from 'react-native-reanimated'

type SignUpFormValues = {
  emailAddress: string
  password: string
}

type VerifyFormValues = {
  code: string
}

export default function SignUpScreen() {
  const { isLoaded, signUp, setActive } = useSignUp()
  const router = useRouter()

  const [pendingVerification, setPendingVerification] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const {
    control,
    handleSubmit,
    watch,
  } = useForm<SignUpFormValues>({
    defaultValues: {
      emailAddress: '',
      password: '',
    },
  })

  const {
    control: verifyControl,
    handleSubmit: handleVerifySubmit,
    reset: resetVerifyForm,
  } = useForm<VerifyFormValues>({
    defaultValues: {
      code: '',
    },
  })

  const emailAddress = watch('emailAddress')

  const showError = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT)
    } else {
      Alert.alert('Error', message)
    }
  }

  // Handle submission of sign-up form
  const onSignUpPress = async ({ emailAddress, password }: SignUpFormValues) => {
    if (!isLoaded) {
      showError('Authentication is still loading. Please wait a moment and try again.')
      return
    }

    if (submitting) return

    // Start sign-up process using email and password provided
    try {
      setSubmitting(true)
      await signUp.create({
        emailAddress,
        password,
      })

      // Send user an email with verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })

      // Set 'pendingVerification' to true to display second form
      // and capture OTP code
      setPendingVerification(true)
      resetVerifyForm()
    } catch (err: any) {
      const message = err?.errors?.[0]?.message ?? 'Unable to sign up'
      showError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const onSignUpInvalid = (formErrors: FieldErrors<SignUpFormValues>) => {
    const firstError = Object.values(formErrors)[0]
    const message =
      typeof firstError === 'object' && firstError && 'message' in firstError
        ? String(firstError.message)
        : null
    if (message) {
      showError(message)
    }
  }

  // Handle submission of verification form
  const onVerifyPress = async ({ code }: VerifyFormValues) => {
    if (!isLoaded) {
      showError('Authentication is still loading. Please wait a moment and try again.')
      return
    }

    if (submitting) return

    try {
      setSubmitting(true)
      // Trim and clean the code (remove any spaces or non-numeric characters)
      const cleanCode = code.trim().replace(/\s+/g, '')

      if (cleanCode.length !== 6) {
        showError('Please enter a valid 6-digit code')
        return
      }

      // Use the code the user provided to attempt verification
      const signUpAttempt = await signUp.attemptEmailAddressVerification({
        code: cleanCode,
      })

      // If verification was completed, set the session to active
      // and redirect the user
      if (signUpAttempt.status === 'complete') {
        await setActive({ session: signUpAttempt.createdSessionId })
        router.replace('/')
      } else {
        showError('Additional steps are required to finish verification.')
      }
    } catch (err: any) {
      const errorCode = err?.errors?.[0]?.code
      const message = err?.errors?.[0]?.message ?? 'Invalid verification code'

      // Provide more specific error messages
      if (errorCode === 'form_code_incorrect') {
        showError('The verification code is incorrect. Please check and try again.')
      } else if (errorCode === 'form_code_expired') {
        showError('The verification code has expired. Please request a new one.')
      } else {
        showError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onVerifyInvalid = (formErrors: FieldErrors<VerifyFormValues>) => {
    const firstError = Object.values(formErrors)[0]
    const message =
      typeof firstError === 'object' && firstError && 'message' in firstError
        ? String(firstError.message)
        : null
    if (message) {
      showError(message)
    }
  }

  if (pendingVerification) {
    return (
      <LinearGradient colors={['#f8fafc', '#eef2ff', '#ecfeff']} style={styles.safeArea}>
        <SafeAreaView style={styles.safeAreaInner}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.wrapper}
          >
            <Animated.View
              style={styles.card}
              entering={FadeInUp.duration(350)}
              layout={Layout.springify()}
            >
              <Animated.View entering={FadeInDown.duration(350)}>
                <Text style={styles.title}>Verify email</Text>
                <Text style={styles.subtitle}>
                  Enter the 6-digit code we sent to {emailAddress}
                </Text>
              </Animated.View>
              <Controller
                control={verifyControl}
                name="code"
                rules={{
                  required: 'Verification code is required',
                  minLength: { value: 6, message: 'Code must be 6 digits' },
                  maxLength: { value: 6, message: 'Code must be 6 digits' },
                  pattern: {
                    value: /^\d+$/,
                    message: 'Code must contain only numbers',
                  },
                }}
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={styles.input}
                    value={value}
                    placeholder="123456"
                    keyboardType="number-pad"
                    placeholderTextColor="#9AA0B4"
                    onBlur={onBlur}
                    onChangeText={(text) => {
                      // Only allow numeric input and limit to 6 digits
                      const numericText = text.replace(/[^0-9]/g, '').slice(0, 6)
                      onChange(numericText)
                    }}
                    maxLength={6}
                  />
                )}
              />
              <Animated.View entering={FadeInUp.duration(300).delay(140)}>
                <TouchableOpacity
                  style={[styles.button, submitting && styles.buttonDisabled]}
                  disabled={submitting}
                  onPress={handleVerifySubmit(onVerifyPress, onVerifyInvalid)}
                >
                  <Text style={styles.buttonText}>{submitting ? 'Please wait...' : 'Verify & Continue'}</Text>
                </TouchableOpacity>
              </Animated.View>

              <Animated.View entering={FadeInUp.duration(300).delay(200)}>
                <TouchableOpacity
                  style={styles.resendButton}
                  onPress={async () => {
                    if (!isLoaded) return
                    try {
                      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
                      showError('New verification code sent!')
                    } catch (err: any) {
                      const message = err?.errors?.[0]?.message ?? 'Failed to resend code'
                      showError(message)
                    }
                  }}
                >
                  <Text style={styles.resendButtonText}>Resend Code</Text>
                </TouchableOpacity>
              </Animated.View>
            </Animated.View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    )
  }

  return (
    <LinearGradient colors={['#f8fafc', '#eef2ff', '#ecfeff']} style={styles.safeArea}>
      <SafeAreaView style={styles.safeAreaInner}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.wrapper}
        >
          <Animated.View
            style={styles.card}
            entering={FadeInUp.duration(350)}
            layout={Layout.springify()}
          >
            <Animated.View entering={FadeInDown.duration(350)}>
              <Text style={styles.title}>Create account</Text>
              <Text style={styles.subtitle}>It only takes a moment</Text>
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
                    placeholder="Create a password"
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
                onPress={handleSubmit(onSignUpPress, onSignUpInvalid)}
              >
                <Text style={styles.buttonText}>{submitting ? 'Please wait...' : 'Continue'}</Text>
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={styles.footer} entering={FadeInUp.duration(300).delay(260)}>
              <Text style={styles.footerText}>Already have an account?</Text>
              <Link href="/(auth)/sign-in">
                <Text style={styles.footerLink}>Sign in</Text>
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
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 6,
    color: '#0f172a',
    textTransform: 'capitalize',
  },
  subtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 24,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: '#1e293b',
    marginBottom: 8,
    fontWeight: '600',
  },
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
    color: '#475569',
  },
  footerLink: {
    color: '#2563eb',
    fontWeight: '700',
  },
  resendButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  resendButtonText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
})
