/**
 * Deterministic Quiz Result Calculation Service — Day 14.
 *
 * Evaluates user answers against a Quiz definition to produce:
 * - correctCount, incorrectCount, unansweredCount, and totalQuestions
 * - score (equal to correctCount) and percentage (0 to 100, rounded)
 * - detailed per-question results with answer status and source traceability
 *
 * Pure function with zero side effects or external dependencies.
 */

/**
 * Calculates the score and per-question breakdown for a quiz attempt.
 *
 * @param {object} quiz — Quiz record with questions array
 * @param {Map<string, string>|Record<string, string>} [userAnswers] — user's selected answers
 * @returns {object} calculated result summary and question breakdown
 */
export function calculateQuizResult(quiz, userAnswers = {}) {
    const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
    const totalQuestions = questions.length;

    // Normalize answers lookup to function
    const getAnswer = (qId) => {
        if (!userAnswers) return null;
        if (typeof userAnswers.get === 'function') {
            const val = userAnswers.get(qId);
            return typeof val === 'string' && val.trim() !== '' ? val : null;
        }
        if (typeof userAnswers === 'object' && Object.hasOwn(userAnswers, qId)) {
            const val = userAnswers[qId];
            return typeof val === 'string' && val.trim() !== '' ? val : null;
        }
        return null;
    };

    if (totalQuestions === 0) {
        return {
            score: 0,
            correctCount: 0,
            incorrectCount: 0,
            unansweredCount: 0,
            totalQuestions: 0,
            percentage: 0,
            answers: {},
            questionResults: [],
        };
    }

    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    const answersRecord = {};
    const questionResults = [];

    questions.forEach((q) => {
        const qId = q.id ?? '';
        const selected = getAnswer(qId);
        const isUnanswered = selected === null;
        const isCorrect = !isUnanswered && selected === q.correctAnswer;

        if (selected !== null) {
            answersRecord[qId] = selected;
        }

        if (isUnanswered) {
            unansweredCount++;
        } else if (isCorrect) {
            correctCount++;
        } else {
            incorrectCount++;
        }

        questionResults.push({
            questionId: qId,
            question: q.question ?? '',
            selectedAnswer: selected,
            correctAnswer: q.correctAnswer ?? '',
            isCorrect,
            isUnanswered,
            sourceChunkIds: Array.isArray(q.sourceChunkIds) ? [...q.sourceChunkIds] : [],
        });
    });

    const percentage = Math.round((correctCount / totalQuestions) * 100);

    return {
        score: correctCount,
        correctCount,
        incorrectCount,
        unansweredCount,
        totalQuestions,
        percentage,
        answers: answersRecord,
        questionResults,
    };
}
