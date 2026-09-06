import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import type { LessonQuizQuestion } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface PublicQuizData {
  token: string;
  status: string;
  submittedAt?: string | null;
  score?: number | null;
  totalQuestions: number;
  studentName?: string | null;
  instructorName?: string | null;
  cycleName?: string | null;
  courseName?: string | null;
  scheduledDate?: string;
  answers?: Record<string, number> | null;
  questions: LessonQuizQuestion[];
}

interface SubmitResponse {
  success: boolean;
  score: number;
  totalQuestions: number;
  questions: LessonQuizQuestion[];
}

export default function PublicLessonQuiz() {
  const { token } = useParams<{ token: string }>();
  const [quiz, setQuiz] = useState<PublicQuizData | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] = useState<SubmitResponse | null>(null);

  useEffect(() => {
    if (!token) return;
    axios
      .get<{ data: PublicQuizData }>(`${API_BASE}/lesson-ai/quiz/${token}`)
      .then((response) => {
        setQuiz(response.data.data);
        if (response.data.data.answers) {
          setAnswers(response.data.data.answers);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'החידון לא נמצא');
        setLoading(false);
      });
  }, [token]);

  const questions = submittedResult?.questions || quiz?.questions || [];
  const score = submittedResult?.score ?? quiz?.score;
  const totalQuestions = submittedResult?.totalQuestions ?? quiz?.totalQuestions ?? questions.length;
  const isSubmitted = Boolean(submittedResult || quiz?.submittedAt);

  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((question) => typeof answers[question.id] === 'number'),
    [answers, questions]
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !allAnswered) return;
    setSubmitting(true);
    try {
      const response = await axios.post<SubmitResponse>(`${API_BASE}/lesson-ai/quiz/${token}/submit`, { answers });
      setSubmittedResult(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'שגיאה בשליחת החידון');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.page} dir="rtl">
        <div style={styles.card}>
          <div style={styles.loading} />
          <p style={styles.muted}>טוען חידון...</p>
        </div>
      </div>
    );
  }

  if (error || !quiz) {
    return (
      <div style={styles.page} dir="rtl">
        <div style={styles.card}>
          <h1 style={styles.errorTitle}>לא ניתן לפתוח את החידון</h1>
          <p style={styles.muted}>{error || 'נסה שוב מאוחר יותר'}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page} dir="rtl">
      <main style={styles.card}>
        <div style={styles.header}>
          <div style={styles.brand}>Hai.Tech</div>
          <h1 style={styles.title}>חידון הבנה לשיעור</h1>
          <p style={styles.subtitle}>
            {quiz.studentName ? `${quiz.studentName} · ` : ''}
            {quiz.courseName || quiz.cycleName || 'שיעור תכנות'}
          </p>
        </div>

        <div style={styles.meta}>
          {quiz.instructorName && <span>מדריך/ה: {quiz.instructorName}</span>}
          {quiz.scheduledDate && <span>תאריך: {new Date(quiz.scheduledDate).toLocaleDateString('he-IL')}</span>}
        </div>

        {isSubmitted && (
          <div style={styles.result}>
            <strong>החידון הוגש.</strong>
            <span>הציון שלך: {score}/{totalQuestions}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={styles.questions}>
            {questions.map((question, questionIndex) => {
              const selected = answers[question.id];
              return (
                <section key={question.id} style={styles.question}>
                  <h2 style={styles.questionTitle}>
                    {questionIndex + 1}. {question.question}
                  </h2>
                  <div style={styles.options}>
                    {question.options.map((option, optionIndex) => {
                      const isCorrect = isSubmitted && question.correctIndex === optionIndex;
                      const isWrongSelection = isSubmitted && selected === optionIndex && question.correctIndex !== optionIndex;
                      return (
                        <label
                          key={`${question.id}-${optionIndex}`}
                          style={{
                            ...styles.option,
                            ...(selected === optionIndex ? styles.optionSelected : {}),
                            ...(isCorrect ? styles.optionCorrect : {}),
                            ...(isWrongSelection ? styles.optionWrong : {}),
                          }}
                        >
                          <input
                            type="radio"
                            name={question.id}
                            value={optionIndex}
                            checked={selected === optionIndex}
                            disabled={isSubmitted}
                            onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                  {isSubmitted && question.explanation && (
                    <p style={styles.explanation}>{question.explanation}</p>
                  )}
                </section>
              );
            })}
          </div>

          {!isSubmitted && (
            <button type="submit" disabled={!allAnswered || submitting} style={{
              ...styles.submit,
              ...(!allAnswered || submitting ? styles.submitDisabled : {}),
            }}>
              {submitting ? 'שולח...' : 'שליחת תשובות'}
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: '24px 12px',
    fontFamily: "Arial, 'Helvetica Neue', sans-serif",
    color: '#111827',
  },
  card: {
    width: '100%',
    maxWidth: 760,
    margin: '0 auto',
    background: '#ffffff',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
    boxShadow: '0 10px 28px rgba(15, 23, 42, 0.08)',
  },
  header: {
    background: '#0f766e',
    color: '#ffffff',
    padding: '28px 24px',
  },
  brand: {
    fontWeight: 700,
    marginBottom: 10,
    fontSize: 15,
  },
  title: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.25,
  },
  subtitle: {
    margin: '10px 0 0',
    color: '#d1fae5',
    fontSize: 16,
  },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    padding: '16px 24px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    color: '#4b5563',
    fontSize: 14,
  },
  result: {
    margin: '20px 24px 0',
    padding: 14,
    borderRadius: 8,
    border: '1px solid #bbf7d0',
    background: '#ecfdf5',
    color: '#166534',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  questions: {
    padding: 24,
    display: 'grid',
    gap: 18,
  },
  question: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 16,
    background: '#ffffff',
  },
  questionTitle: {
    margin: '0 0 12px',
    fontSize: 18,
    lineHeight: 1.5,
  },
  options: {
    display: 'grid',
    gap: 10,
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    cursor: 'pointer',
    minHeight: 46,
  },
  optionSelected: {
    borderColor: '#0f766e',
    background: '#f0fdfa',
  },
  optionCorrect: {
    borderColor: '#16a34a',
    background: '#f0fdf4',
  },
  optionWrong: {
    borderColor: '#dc2626',
    background: '#fef2f2',
  },
  explanation: {
    margin: '12px 0 0',
    color: '#4b5563',
    lineHeight: 1.6,
  },
  submit: {
    margin: '0 24px 24px',
    width: 'calc(100% - 48px)',
    minHeight: 48,
    border: 0,
    borderRadius: 8,
    background: '#0f766e',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },
  submitDisabled: {
    background: '#9ca3af',
    cursor: 'not-allowed',
  },
  muted: {
    color: '#6b7280',
    textAlign: 'center',
  },
  loading: {
    width: 42,
    height: 42,
    margin: '36px auto 14px',
    border: '4px solid #d1d5db',
    borderTopColor: '#0f766e',
    borderRadius: '50%',
  },
  errorTitle: {
    margin: '36px 24px 12px',
    color: '#b91c1c',
    textAlign: 'center',
    fontSize: 24,
  },
};
