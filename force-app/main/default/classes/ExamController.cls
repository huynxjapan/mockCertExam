public with sharing class ExamController {

    public class ExamWrapper {
        @AuraEnabled public Attempt__c attempt { get; set; }
        @AuraEnabled public List<QuestionWrapper> questions { get; set; }
        @AuraEnabled public Integer durationMinutes { get; set; }
    }

    public class QuestionWrapper {
        @AuraEnabled public Id questionId { get; set; }
        @AuraEnabled public String questionText { get; set; }
        @AuraEnabled public String type { get; set; }
        @AuraEnabled public String explanation { get; set; }
        @AuraEnabled public List<OptionWrapper> options { get; set; }
    }

    public class OptionWrapper {
        @AuraEnabled public Id id { get; set; }
        @AuraEnabled public String optionText { get; set; }
        @AuraEnabled public Boolean isCorrect { get; set; }
    }

    @AuraEnabled
    public static ExamWrapper startExam(Id examId, String mode) {
        Exam__c exam = [SELECT Id, Duration_Minutes__c, Total_Questions__c FROM Exam__c WHERE Id = :examId LIMIT 1];
        
        // 1. create new Attempt
        Attempt__c attempt = new Attempt__c(
            Exam__c = examId,
            Status__c = 'In Progress',
            Start_Time__c = System.now()
        );
        insert attempt;

        Integer maxQuestions = exam.Total_Questions__c != null ? exam.Total_Questions__c.intValue() : 50;
        
        // 2. query exam questions
        List<Exam_Question__c> questions = [
            SELECT Id, Text__c, Type__c, Explanation__c 
            FROM Exam_Question__c 
            WHERE Exam__c = :examId 
            LIMIT :maxQuestions
        ];

        Set<Id> questionIds = new Set<Id>();
        for(Exam_Question__c q : questions) {
            questionIds.add(q.Id);
        }

        // 3. question answer options
        Map<Id, List<OptionWrapper>> qToOptionsMap = new Map<Id, List<OptionWrapper>>();
        for(Question_Option__c opt : [
            SELECT Id, Option_Text__c, Is_Correct__c, Exam_Question__c 
            FROM Question_Option__c 
            WHERE Exam_Question__c IN :questionIds
        ]) {
            if(!qToOptionsMap.containsKey(opt.Exam_Question__c)) {
                qToOptionsMap.put(opt.Exam_Question__c, new List<OptionWrapper>());
            }
            
            OptionWrapper ow = new OptionWrapper();
            ow.id = opt.Id;
            ow.optionText = opt.Option_Text__c;
            // ensure security, only pass the correct flag when is in practice mode
            ow.isCorrect = (mode == 'Practice') ? opt.Is_Correct__c : false;
            
            qToOptionsMap.get(opt.Exam_Question__c).add(ow);
        }

        // 4. pakaging
        List<QuestionWrapper> wrappedQuestions = new List<QuestionWrapper>();
        for(Exam_Question__c q : questions) {
            QuestionWrapper qw = new QuestionWrapper();
            qw.questionId = q.Id;
            qw.questionText = q.Text__c;
            qw.type = q.Type__c;
            qw.explanation = (mode == 'Practice') ? q.Explanation__c : '';
            qw.options = qToOptionsMap.containsKey(q.Id) ? qToOptionsMap.get(q.Id) : new List<OptionWrapper>();
            wrappedQuestions.add(qw);
        }

        ExamWrapper ew = new ExamWrapper();
        ew.attempt = attempt;
        ew.questions = wrappedQuestions;
        ew.durationMinutes = exam.Duration_Minutes__c != null ? exam.Duration_Minutes__c.intValue() : 60;
        return ew;
    }

    @AuraEnabled
    public static void submitExam(Id attemptId, String responsesJson) {
        // create correct answers
        Map<Id, List<String>> userAnswers = (Map<Id, List<String>>) JSON.deserialize(responsesJson, Map<Id, List<String>>.class);
        Attempt__c attempt = [SELECT Id, Exam__c FROM Attempt__c WHERE Id = :attemptId LIMIT 1];
        List<Question_Option__c> allCorrectOptions = [SELECT Id, Exam_Question__c, Is_Correct__c FROM Question_Option__c WHERE Exam_Question__c IN :userAnswers.keySet()];
        Map<Id, Set<Id>> correctMap = new Map<Id, Set<Id>>();
        for(Question_Option__c opt : allCorrectOptions) {
            if(opt.Is_Correct__c) {
                if(!correctMap.containsKey(opt.Exam_Question__c)) correctMap.put(opt.Exam_Question__c, new Set<Id>());
                correctMap.get(opt.Exam_Question__c).add(opt.Id);
            }
        }
        // create new attempt answers and count correct
        List<Attempt_Answer__c> answersToInsert = new List<Attempt_Answer__c>();
        Integer correctCount = 0;
        for(Id qId : userAnswers.keySet()) {
            List<String> selected = userAnswers.get(qId);
            answersToInsert.add(new Attempt_Answer__c(Attempt__c = attemptId, Exam_Question__c = qId, Selected_Options__c = String.join(selected, ';')));
            Set<Id> correctIds = correctMap.containsKey(qId) ? correctMap.get(qId) : new Set<Id>();
            Set<String> selectedSet = new Set<String>(selected);
            Boolean isCorrect = true;
            if(correctIds.size() != selectedSet.size()) { isCorrect = false; } else {
                for(Id cId : correctIds) { if(!selectedSet.contains(String.valueOf(cId))) { isCorrect = false; break; } }
            }
            if(isCorrect) correctCount++;
        }
        insert answersToInsert;
        // calculate and update attempt
        attempt.Status__c = 'Submitted';
        attempt.Score__c = userAnswers.size() > 0 ? ((Decimal)correctCount / userAnswers.size()) * 100 : 0;
        update attempt;
    }
}