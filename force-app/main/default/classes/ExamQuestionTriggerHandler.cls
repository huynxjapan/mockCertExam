public with sharing class ExamQuestionTriggerHandler {
    Map<String,String> fieldMap = new Map<String,String>{
        'A__c' => 'A',
        'B__c' => 'B',
        'C__c' => 'C',
        'D__c' => 'D',
        'E__c' => 'E'
    };

    public void handleBeforeInsert(List<Exam_Question__c> newQuestions) {
        for(Exam_Question__c eq : newQuestions) {
            Integer countCorrectOption = eq.Correct_Answer__c != null ? eq.Correct_Answer__c.countMatches(',') : 0;
            if(countCorrectOption > 0) {
                eq.Type__c = 'Multi Select';
            } else {
                eq.Type__c = 'Single Select';
            }
        }
    }
    public void handleAfterInsert(List<Exam_Question__c> newQuestions) {
        createQuestionOptions(newQuestions);
    }

    private void createQuestionOptions(List<Exam_Question__c> newQuestions) {
        List<Question_Option__c> optionsToInsert = new List<Question_Option__c>();
        
        for (Exam_Question__c eq : newQuestions) {
            for (String fieldName : fieldMap.keySet()) {
                // Dynamically retrieve the value of fields A, B, C, D, or E
                String optionText = (String)eq.get(fieldName);
                
                // Check if the field has a value (is not blank)
                if (String.isNotBlank(optionText)) {
                    Question_Option__c newOption = new Question_Option__c(
                        Exam_Question__c = eq.Id,   // Link option back to the parent Exam Question record
                        Option_Text__c = optionText 
                    );
                    // Determine if this option is correct based on the Correct_Answer__c field
                    if (eq.Correct_Answer__c.contains(fieldMap.get(fieldName))) {
                        newOption.Is_Correct__c = true;
                    } else {
                        newOption.Is_Correct__c = false;
                    }
                    optionsToInsert.add(newOption);
                }
            }
        }
        
        // Bulk insert options safely outside the loops
        if (!optionsToInsert.isEmpty()) {
            insert optionsToInsert;
        }
    }
}