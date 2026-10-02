import { LightningElement, api, track } from 'lwc';
import startExam from '@salesforce/apex/ExamController.startExam';
import submitExam from '@salesforce/apex/ExamController.submitExam';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class ExamEngine extends LightningElement {
    @api recordId;
    
    @track questions = [];
    @track responses = {}; // { questionId: [selectedOptionIds] }
    @track markedForReview = new Set();
    @track revealedQuestions = new Set(); // 練習モードで解説表示済みの質問IDを追跡
    
    currentQuestionIndex = 0;
    timeLeftSeconds = 0;
    timerInterval;
    attemptId;
    selectedMode = ''; // 'Practice' or 'Real'
    
    isLoading = false;
    isExamStarted = false;
    isExamSubmitted = false;

    get currentQuestionIndexDisplay() { return this.currentQuestionIndex + 1; }
    get totalQuestions() { return this.questions.length; }
    get isFirstQuestion() { return this.currentQuestionIndex === 0; }
    get isLastQuestion() { return this.currentQuestionIndex === this.questions.length - 1; }
    
    get isRealMode() { return this.selectedMode === 'Real'; }
    get isPracticeMode() { return this.selectedMode === 'Practice'; }
    
    // 練習モードかつ現在問題の答え合わせがまだされていない状態
    get isCurrentQuestionRevealed() {
        return this.currentQuestion ? this.revealedQuestions.has(this.currentQuestion.questionId) : false;
    }

    // 右側の解説パネル表示条件
    get showRightPanel() {
        return this.isPracticeMode && this.isCurrentQuestionRevealed;
    }

    // 中央の問題エリアの横幅比率をモードによって可変にする
    get questionCanvasClass() {
        return this.showRightPanel 
            ? 'slds-col slds-size_2-of-5 slds-p-around_large' 
            : 'slds-col slds-size_4-of-5 slds-p-around_large';
    }

    get currentQuestion() {
        if (this.questions.length === 0) return null;
        let q = this.questions[this.currentQuestionIndex];
        let currentSelected = this.responses[q.questionId] || [];
        const isRevealed = this.revealedQuestions.has(q.questionId);
        
        q.options = q.options.map(opt => {
            let cls = 'slds-radio slds-m-vertical_small option-wrapper ';
            // 練習モードかつ答え合わせ後の場合、正解・不正解クラスを割り当てる
            if (this.isPracticeMode && isRevealed) {
                if (opt.isCorrect) {
                    cls += 'correct-option ';
                } else if (currentSelected.includes(opt.id) && !opt.isCorrect) {
                    cls += 'incorrect-option ';
                }
            }
            return {
                ...opt,
                isSelected: currentSelected.includes(opt.id),
                wrapperClass: cls
            };
        });
        return q;
    }

    get isSingleSelect() {
        return this.currentQuestion ? this.currentQuestion.type === 'Single Select' : true;
    }

    get currentQuestionMarked() {
        return this.currentQuestion ? this.markedForReview.has(this.currentQuestion.questionId) : false;
    }

    get formattedTimeLeft() {
        const mins = Math.floor(this.timeLeftSeconds / 60);
        const secs = this.timeLeftSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // 練習モード時の各種ボタン制御
    get showCheckAnswerButton() {
        return this.isPracticeMode && !this.isCurrentQuestionRevealed;
    }

    get isNextDisabledInPractice() {
        const qId = this.currentQuestion?.questionId;
        return !(this.responses[qId] && this.responses[qId].length > 0);
    }

    get isNextButtonDisabled() {
        if (this.isLastQuestion) return true;
        // 練習モードの場合、解説を見る（Revealする）までNextボタンを押せない
        if (this.isPracticeMode && !this.isCurrentQuestionRevealed) return true;
        return false;
    }

    get nextButtonVariant() {
        return (this.isPracticeMode && !this.isCurrentQuestionRevealed) ? 'neutral' : 'brand';
    }

    // 現在選択中の回答が完全に正しいか判定（右側パネルのVerdict表示用）
    get isCurrentAnswerCorrect() {
        if (!this.currentQuestion) return false;
        const qId = this.currentQuestion.questionId;
        const selected = this.responses[qId] || [];
        
        const correctIds = this.currentQuestion.options
            .filter(o => o.isCorrect)
            .map(o => o.id);

        if (selected.length !== correctIds.length) return false;
        return correctIds.every(id => selected.includes(id));
    }

    get navigationMap() {
        return this.questions.map((q, idx) => {
            let classes = 'slds-button slds-button_outline-brand nav-btn ';
            if (idx === this.currentQuestionIndex) classes += 'active-nav ';
            
            if (this.markedForReview.has(q.questionId)) {
                classes += 'marked-nav ';
            } else if ((this.responses[q.questionId] || []).length > 0) {
                classes += 'answered-nav ';
            }
            return {
                id: q.questionId,
                index: idx,
                label: `${idx + 1}`,
                className: classes
            };
        });
    }

    handleStartExam(event) {
        this.selectedMode = event.target.dataset.mode;
        this.isLoading = true;
        
        startExam({ examId: this.recordId, mode: this.selectedMode })
            .then(result => {
                this.attemptId = result.attempt.Id;
                this.questions = result.questions;
                this.timeLeftSeconds = result.durationMinutes * 60;
                this.isExamStarted = true;
                
                if (this.isRealMode) {
                    this.startTimer();
                }
            })
            .catch(error => {
                this.showToast('Error', error.body.message, 'error');
            })
            .finally(() => { this.isLoading = false; });
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            if (this.timeLeftSeconds > 0) {
                this.timeLeftSeconds--;
            } else {
                clearInterval(this.timerInterval);
                this.handleSubmitExam();
            }
        }, 1000);
    }

    handleOptionSelect(event) {
        const qId = this.currentQuestion.questionId;
        const optId = event.target.value;

        if (this.isSingleSelect) {
            this.responses[qId] = [optId];
        } else {
            let currentSelections = [...(this.responses[qId] || [])];
            if (event.target.checked) {
                if (!currentSelections.includes(optId)) currentSelections.push(optId);
            } else {
                currentSelections = currentSelections.filter(id => id !== optId);
            }
            this.responses[qId] = currentSelections;
        }
        this.responses = { ...this.responses };
    }

    handleRevealAnswer() {
        const qId = this.currentQuestion.questionId;
        this.revealedQuestions.add(qId);
        this.revealedQuestions = new Set(this.revealedQuestions); // 反応性を維持
    }

    handleMarkReview(event) {
        const qId = this.currentQuestion.questionId;
        if (event.target.checked) {
            this.markedForReview.add(qId);
        } else {
            this.markedForReview.delete(qId);
        }
        this.markedForReview = new Set(this.markedForReview);
    }

    handleNavigateQuestion(event) {
        const targetIdx = parseInt(event.target.dataset.index, 10);
        
        // 練習モードの制限：前の問題に戻るか、すでに解説済みの問題なら自由に移動可能。未回答問題へのスキップは不可
        if (this.isPracticeMode && targetIdx > this.currentQuestionIndex && !this.isCurrentQuestionRevealed) {
            this.showToast('Locked', 'Please check the answer for the current question before moving forward.', 'warning');
            return;
        }
        this.currentQuestionIndex = targetIdx;
    }

    handleNext() { 
        if (!this.isLastQuestion) this.currentQuestionIndex++; 
    }
    
    handlePrev() { 
        if (!this.isFirstQuestion) this.currentQuestionIndex--; 
    }

    handleSubmitExam() {
        clearInterval(this.timerInterval);
        this.isLoading = true;
        
        submitExam({
            attemptId: this.attemptId,
            responsesJson: JSON.stringify(this.responses)
        })
        .then(() => {
            this.isExamSubmitted = true;
            this.showToast('Success', 'Exam session finished and calculated.', 'success');
        })
        .catch(error => {
            this.showToast('Submission Error', error.body.message, 'error');
        })
        .finally(() => { this.isLoading = false; });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    disconnectedCallback() {
        clearInterval(this.timerInterval);
    }
}